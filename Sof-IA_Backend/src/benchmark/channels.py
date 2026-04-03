"""Concrete implementations of the ProgressChannel protocol.

Three implementations cover all current use cases:

PrintProgressChannel
    Writes events to stdout and logs at DEBUG.  Used by the CLI.

QueueProgressChannel
    Puts events onto an ``asyncio.Queue`` via ``call_soon_threadsafe`` so
    they can be consumed by the SSE endpoint from a thread-pool executor.
    Used by the web server.

NullProgressChannel
    Discards all events silently.  Used in tests and when no reporting is
    needed.

Phase 2 note
------------
``send_token`` and ``send_chunk`` are stubbed as no-ops in all three
implementations.  They will be filled in during Phase 2 (streaming mode).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class PrintProgressChannel:
    """Writes progress events to stdout and logs at DEBUG.

    Intended for CLI use where there is no event loop.
    """

    def __init__(self, job_id: str = "-") -> None:
        self._job_id = job_id

    def send_progress(self, msg: str) -> None:
        print(f"  [{msg}]")
        logger.debug("channel_progress msg=%s", msg, extra={"job_id": self._job_id})

    def send_done(self, result: dict) -> None:
        print(f"  [done result_id={result.get('result_id', '-')}]")
        logger.debug("channel_done", extra={"job_id": self._job_id})

    def send_error(self, msg: str) -> None:
        print(f"  [error {msg}]")
        logger.debug("channel_error msg=%s", msg, extra={"job_id": self._job_id})

    def send_token(self, token: str, index: int) -> None:
        print(token, end="", flush=True)
        logger.debug("channel_token index=%d", index, extra={"job_id": self._job_id})

    def send_chunk(self, partial: str, index: int) -> None:
        print(f"\r[chunk {index}] {partial}", end="", flush=True)
        logger.debug("channel_chunk index=%d", index, extra={"job_id": self._job_id})


class QueueProgressChannel:
    """Puts progress events onto an asyncio.Queue for SSE delivery.

    Must be created from the async context (event loop thread) so that
    ``call_soon_threadsafe`` targets the correct loop.  The benchmark runs
    in a thread-pool executor; ``call_soon_threadsafe`` bridges back safely.

    Args:
        queue: The job's dedicated ``asyncio.Queue``.
        loop: The running event loop (obtained via ``asyncio.get_event_loop()``
            in the async route handler).
        job_id: Job ID for log correlation.
    """

    def __init__(self, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop, job_id: str) -> None:
        self._queue = queue
        self._loop = loop
        self._job_id = job_id

    def _put(self, event: dict) -> None:
        self._loop.call_soon_threadsafe(self._queue.put_nowait, event)
        logger.debug("channel_event type=%s", event.get("type"), extra={"job_id": self._job_id})

    def send_progress(self, msg: str) -> None:
        self._put({"type": "progress", "message": msg})

    def send_done(self, result: dict) -> None:
        self._put({"type": "done", "result": result})

    def send_error(self, msg: str) -> None:
        self._put({"type": "error", "message": msg})

    def send_token(self, token: str, index: int) -> None:
        self._put({"type": "token", "token": token, "index": index})

    def send_chunk(self, partial: str, index: int) -> None:
        self._put({"type": "chunk", "partial": partial, "chunk_index": index})


class NullProgressChannel:
    """Discards all events silently.  Use in tests or when no reporting is needed."""

    def send_progress(self, msg: str) -> None:  # noqa: ARG002
        pass

    def send_done(self, result: dict) -> None:  # noqa: ARG002
        pass

    def send_error(self, msg: str) -> None:  # noqa: ARG002
        pass

    def send_token(self, token: str, index: int) -> None:  # noqa: ARG002
        pass

    def send_chunk(self, partial: str, index: int) -> None:  # noqa: ARG002
        pass