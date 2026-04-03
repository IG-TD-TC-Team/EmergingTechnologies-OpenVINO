"""HTTP request logging middleware and audit event helpers.

This module provides two concerns:

1. **Request logging** — :class:`RequestLoggingMiddleware` logs every HTTP
   request with method, path, status code, duration, and client IP to the
   root logger (which writes to the console and ``logs/app.json``).

2. **Audit trail** — :func:`audit_event` writes structured entries to the
   dedicated ``"audit"`` logger (``logs/audit.log`` only, no propagation).
   This logger never receives raw prompt text; instead callers pass a
   :func:`hash_prompt` digest to satisfy healthcare compliance requirements
   while keeping PHI out of log files.

Audit events recorded by the server:

| Event | Trigger |
|---|---|
| ``benchmark_started`` | ``POST /api/benchmark/start`` |
| ``benchmark_failed`` | Job error handler |
| ``result_accessed`` | ``GET /api/results/{id}`` |
"""

import hashlib
import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_logger = logging.getLogger(__name__)
_audit  = logging.getLogger("audit")


def hash_prompt(text: str) -> str:
    """Return the first 16 hex characters of the SHA-256 digest of ``text``.

    Used to record that a specific prompt was submitted without storing the
    raw text, keeping PHI out of log files while still allowing correlation
    between audit entries that reference the same prompt.

    Args:
        text: The raw prompt string (e.g. a clinical note request).

    Returns:
        A 16-character lowercase hex string, e.g. ``"a3f2c1b04d7e9082"``.
    """
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def audit_event(
    action: str,
    client_ip: str,
    job_id: str = "-",
    prompt_hash: str | None = None,
    result_id: str | None = None,
    **kwargs,
) -> None:
    """Write one structured entry to the audit logger.

    The ``"audit"`` logger has ``propagate = False``, so entries appear
    **only** in ``logs/audit.log`` and never in the console or
    ``logs/app.json``.  This keeps the audit trail separate from the
    operational log and simplifies compliance review.

    Args:
        action: Short event name, e.g. ``"benchmark_started"``.
        client_ip: IP address of the HTTP client that triggered the event.
        job_id: Benchmark job UUID, or ``"-"`` when no job is associated.
        prompt_hash: 16-char SHA-256 prefix of the raw prompt text
            (SLM benchmarks only).  ``None`` when not applicable (ASR).
        result_id: Filename stem of the accessed result
            (e.g. ``"benchmark_20260101_120000"``).  ``None`` when not
            applicable.
        **kwargs: Additional key/value pairs merged into the JSON entry
            (e.g. ``model_id``, ``error``).
    """
    extra = {"job_id": job_id, "client_ip": client_ip, "action": action}
    if prompt_hash is not None:
        extra["prompt_hash"] = prompt_hash
    if result_id is not None:
        extra["result_id"] = result_id
    extra.update(kwargs)
    _audit.info(action, extra=extra)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that logs every HTTP request to the root logger.

    Each request produces one INFO-level entry with the fields:
    ``method``, ``path``, ``status_code``, ``duration_ms``, and
    ``client_ip``.

    SSE stream endpoints (paths containing ``/stream``) are **skipped**
    because their connection is long-lived and the duration would be
    misleading.  The ``RequestLoggingMiddleware`` is registered in
    ``web/server.py`` and writes to ``logs/app.json`` via the root logger.
    """

    async def dispatch(self, request: Request, call_next):
        """Process the request and emit a structured log entry.

        Args:
            request: The incoming Starlette request object.
            call_next: The next middleware or route handler in the chain.

        Returns:
            The HTTP response returned by the downstream handler.
        """
        if "/stream" in request.url.path:
            return await call_next(request)

        t0 = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - t0) * 1000

        client_ip = request.client.host if request.client else "-"
        _logger.info(
            "http %s %s %d %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            extra={"client_ip": client_ip},
        )
        return response
