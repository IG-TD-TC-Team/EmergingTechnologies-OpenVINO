"""
In-memory job store for background benchmark tasks.

All access goes through the module-level functions — nothing outside
this file reads or writes _jobs directly.

Job lifecycle:
    PENDING → RUNNING → DONE | FAILED
"""

import asyncio
from typing import Optional

# -----------------------------------------------------------------------
# Job state constants
# -----------------------------------------------------------------------
PENDING = "pending"
RUNNING = "running"
DONE    = "done"
FAILED  = "failed"

# -----------------------------------------------------------------------
# Internal store  (single-worker Uvicorn — no race conditions)
# -----------------------------------------------------------------------
_jobs: dict[str, dict] = {}


# -----------------------------------------------------------------------
# Write helpers
# -----------------------------------------------------------------------

def create_job(job_id: str) -> dict:
    """Register a new job in PENDING state."""
    job = {
        "id": job_id,
        "status": PENDING,
        "queue": asyncio.Queue(),
        "result": None,
        "error": None,
    }
    _jobs[job_id] = job
    return job


def set_running(job_id: str) -> None:
    _jobs[job_id]["status"] = RUNNING


def set_done(job_id: str, result: dict) -> None:
    job = _jobs[job_id]
    job["status"] = DONE
    job["result"] = result


def set_failed(job_id: str, error: str) -> None:
    job = _jobs[job_id]
    job["status"] = FAILED
    job["error"] = error


# -----------------------------------------------------------------------
# Read helpers
# -----------------------------------------------------------------------

def get_job(job_id: str) -> Optional[dict]:
    """Return job dict or None if not found."""
    return _jobs.get(job_id)


def get_queue(job_id: str) -> Optional[asyncio.Queue]:
    job = _jobs.get(job_id)
    return job["queue"] if job else None
