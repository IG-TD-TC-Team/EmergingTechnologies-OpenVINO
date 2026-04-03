"""Centralized logging configuration for the OpenVino benchmarking app.

Call :func:`setup_logging` **once** at application startup — in the FastAPI
``lifespan`` context manager or at the top of the CLI ``main()`` function.
Subsequent calls are no-ops due to the idempotency guard, so it is safe to
import and call from multiple modules.

Three handlers are registered on the root logger:

1. **Console** — human-readable, ANSI-colored by level.
2. **logs/app.json** — rotating JSON lines file (5 MB × 3 backups).
   Used by the ``GET /api/logs`` endpoint to power the dashboard Logs tab.
3. **logs/audit.log** — rotating JSON lines file (2 MB × 5 backups).
   Attached **only** to the ``"audit"`` logger (``propagate = False``),
   so PHI-adjacent audit events never appear in the console or app.json.

Log correlation:
    Every structured log call that originates from a benchmark job passes
    ``extra={"job_id": job_id}``.  The :class:`JsonFormatter` merges this
    into the JSON object so entries can be filtered by job in the dashboard
    or a log aggregator.

Noise suppression:
    ``uvicorn.access``, ``transformers``, and ``optimum`` loggers are set
    to ``WARNING`` to reduce noise from third-party libraries.
"""

import json
import logging
import logging.handlers
from pathlib import Path

# Standard LogRecord instance attributes (set in LogRecord.__init__).
# These are NOT in LogRecord.__dict__ (the class dict), so a naive
# ``key not in LogRecord.__dict__`` check leaks them into the JSON entry.
_LOGRECORD_ATTRS = frozenset({
    "args", "created", "exc_info", "exc_text", "filename", "funcName",
    "levelname", "levelno", "lineno", "message", "module", "msecs",
    "msg", "name", "pathname", "process", "processName", "relativeCreated",
    "stack_info", "taskName", "thread", "threadName",
})

_REPO_ROOT = Path(__file__).resolve().parents[1]

# ANSI color codes
_COLORS = {
    "DEBUG":    "\033[36m",   # cyan
    "INFO":     "\033[32m",   # green
    "WARNING":  "\033[33m",   # yellow
    "ERROR":    "\033[31m",   # red
    "CRITICAL": "\033[31m",   # red
}
_RESET = "\033[0m"


class ColorFormatter(logging.Formatter):
    """Console log formatter that adds ANSI color codes around the level name.

    Colors by level:

    - ``DEBUG``    → cyan
    - ``INFO``     → green
    - ``WARNING``  → yellow
    - ``ERROR`` / ``CRITICAL`` → red

    The log record is shallow-copied before mutation so the original
    ``levelname`` remains uncolored for the other handlers (e.g.
    :class:`JsonFormatter`).
    """

    _FMT = "%(asctime)s [%(levelname)-8s] %(name)s %(message)s"

    def format(self, record: logging.LogRecord) -> str:
        """Format ``record`` with ANSI-colored level name.

        Args:
            record: The log record to format.

        Returns:
            Formatted log line with ANSI escape codes around the level name.
        """
        color = _COLORS.get(record.levelname, "")
        record = logging.makeLogRecord(record.__dict__)
        record.levelname = f"{color}{record.levelname}{_RESET}"
        return logging.Formatter(self._FMT).format(record)


class JsonFormatter(logging.Formatter):
    """Log formatter that emits one JSON object per line.

    Each line contains the following keys:

    - ``ts`` — ISO 8601 timestamp (``YYYY-MM-DDTHH:MM:SS``).
    - ``level`` — log level string (e.g. ``"INFO"``).
    - ``logger`` — dotted logger name (e.g. ``"src.benchmark.runner"``).
    - ``msg`` — formatted message string.
    - ``job_id`` — benchmark job UUID, or ``"-"`` for non-job log entries.
    - Any additional fields passed via ``extra={}`` are merged in.
    - ``exc`` — formatted traceback string (only present when
      ``exc_info`` is attached to the record).

    This format is consumed by the ``GET /api/logs`` endpoint and is
    compatible with log aggregators such as Loki or Elasticsearch.
    """

    def format(self, record: logging.LogRecord) -> str:
        """Serialize ``record`` to a single JSON line.

        Args:
            record: The log record to serialize.

        Returns:
            A JSON string with no trailing newline.
        """
        entry: dict = {
            "ts":     self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level":  record.levelname,
            "logger": record.name,
            "msg":    record.getMessage(),
            "job_id": getattr(record, "job_id", "-"),
        }
        # Merge only genuine extra={} fields — skip standard LogRecord
        # instance attrs and anything already written to entry.
        for key, val in record.__dict__.items():
            if (
                key not in _LOGRECORD_ATTRS
                and key not in logging.LogRecord.__dict__
                and key not in entry
                and not key.startswith("_")
            ):
                entry[key] = val
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        # default=str converts any non-serializable value (Path, datetime, …)
        # to its string representation instead of raising TypeError.
        return json.dumps(entry, default=str)


def setup_logging(log_level: str = "INFO", log_dir: Path = _REPO_ROOT / "logs") -> None:
    """Configure the root logger with console and rotating file handlers.

    This function is **idempotent** — if handlers are already attached to the
    root logger, the function returns immediately.  It is safe to call from
    multiple entry points (server lifespan, CLI ``main()``) without risk of
    duplicate handlers.

    After this call:

    - All ``logging.getLogger(name)`` calls produce colored console output
      **and** append a JSON line to ``logs/app.json``.
    - The ``"audit"`` logger writes only to ``logs/audit.log``
      (``propagate = False`` keeps audit events out of the console).

    Args:
        log_level: Minimum log level for the root logger and console handler,
            e.g. ``"DEBUG"`` or ``"INFO"``.  File handlers always capture
            everything the root logger passes through.
        log_dir: Directory where ``app.json`` and ``audit.log`` are created.
            Defaults to ``<repo_root>/logs``.  Created automatically if it
            does not exist.
    """
    root = logging.getLogger()
    if root.handlers:
        return  # already configured

    log_dir.mkdir(parents=True, exist_ok=True)
    level = getattr(logging, log_level.upper(), logging.INFO)
    root.setLevel(level)

    # --- Console handler ---
    console = logging.StreamHandler()
    console.setFormatter(ColorFormatter())
    root.addHandler(console)

    # --- app.json rotating handler ---
    app_handler = logging.handlers.RotatingFileHandler(
        log_dir / "app.json",
        maxBytes=5 * 1024 * 1024,  # 5 MB
        backupCount=3,
        encoding="utf-8",
    )
    app_handler.setFormatter(JsonFormatter())
    root.addHandler(app_handler)

    # --- audit.log — attached to "audit" logger only, no propagation ---
    audit_handler = logging.handlers.RotatingFileHandler(
        log_dir / "audit.log",
        maxBytes=2 * 1024 * 1024,  # 2 MB
        backupCount=5,
        encoding="utf-8",
    )
    audit_handler.setFormatter(JsonFormatter())
    audit_logger = logging.getLogger("audit")
    audit_logger.addHandler(audit_handler)
    audit_logger.propagate = False

    # --- Noise suppression ---
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("transformers").setLevel(logging.WARNING)
    logging.getLogger("optimum").setLevel(logging.WARNING)
