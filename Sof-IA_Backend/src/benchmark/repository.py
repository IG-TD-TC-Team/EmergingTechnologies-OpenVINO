"""Result repository — save and retrieve benchmark result JSON files.

The web server and CLI both go through :class:`ResultRepository`; neither
opens result files directly.  All files are stored under ``results/`` at
the project root with the naming scheme ``benchmark_<timestamp>.json``.
"""

import json
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_RESULTS_DIR = Path(__file__).resolve().parents[2] / "results"


class ResultRepository:
    """Encapsulates all file I/O for benchmark results.

    Each result is stored as::

        results/benchmark_<YYYYmmdd_HHMMSS>.json

    The directory is created on first instantiation if it does not exist.

    Args:
        results_dir: Override the default ``results/`` directory.
            Useful in tests to point at a temporary location.
    """

    def __init__(self, results_dir: Path = _RESULTS_DIR):
        self._dir = results_dir
        self._dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def save(self, result: dict) -> str:
        """Persist a result dict to disk as a timestamped JSON file.

        Args:
            result: Benchmark result produced by
                :func:`~src.benchmark.runner.run_benchmark_sync`.

        Returns:
            The result ID (filename stem), e.g. ``"benchmark_20240101_120000"``.
        """
        result_id = f"benchmark_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        path = self._dir / f"{result_id}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        logger.info("result_saved path=%s", path)
        return result_id

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def list(self) -> list[dict]:
        """Return metadata for all result files, newest first.

        Returns:
            A list of dicts, each with keys ``id`` (str), ``timestamp``
            (str, ``YYYYmmdd_HHMMSS``), and ``model_id`` (str).
            The ``model_id`` is read from the JSON file; on parse error it
            falls back to an empty string.
        """
        files = sorted(self._dir.glob("benchmark_*.json"), reverse=True)
        results = []
        for f in files:
            model_id = ""
            try:
                with open(f, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                model_id = data.get("model_id", "")
            except Exception:
                logger.warning("Failed to read result file %s", f, exc_info=True)
            results.append({
                "id": f.stem,
                "timestamp": f.stem.replace("benchmark_", ""),
                "model_id": model_id,
            })
        return results

    def get(self, result_id: str) -> dict:
        """Load a single result by ID.

        Args:
            result_id: Filename stem, e.g. ``"benchmark_20240101_120000"``.

        Returns:
            Parsed JSON content as a dict.

        Raises:
            FileNotFoundError: If no file matches ``result_id``.
        """
        path = self._dir / f"{result_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"Result not found: {result_id}")
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
