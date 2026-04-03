"""Runtime-checkable protocols for the benchmark system.

These protocols define the contracts that the runner and web layer depend on.
Concrete implementations live in ``channels.py``, ``factory.py``, and
``repository.py``.  Nothing in this module imports from the rest of the
project — it is a pure dependency sink.

Protocols
---------
ProgressChannel
    Receives progress events from a running benchmark job.
ModelProvider
    Creates :class:`~src.benchmark.base.BaseModel` instances by model ID.
ResultStore
    Persists and retrieves benchmark result dicts.
MemoryProvider
    Returns current process RSS in bytes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from src.benchmark.base import BaseModel


@runtime_checkable
class ProgressChannel(Protocol):
    """Receives progress events emitted during a benchmark run.

    Phase 1 methods
    ---------------
    send_progress, send_done, send_error

    Phase 2 methods (no-op stubs in Phase 1 implementations)
    ---------------------------------------------------------
    send_token, send_chunk
    """

    def send_progress(self, msg: str) -> None:
        """Emit a human-readable status update (e.g. ``"warmup 1/3"``)."""
        ...

    def send_done(self, result: dict) -> None:
        """Emit the final benchmark result dict when a run completes."""
        ...

    def send_error(self, msg: str) -> None:
        """Emit an error message when a run fails."""
        ...

    def send_token(self, token: str, index: int) -> None:
        """Emit a single generated token (Phase 2 — streaming SLM)."""
        ...

    def send_chunk(self, partial: str, index: int) -> None:
        """Emit a partial ASR transcript chunk (Phase 2 — streaming ASR)."""
        ...


@runtime_checkable
class ModelProvider(Protocol):
    """Creates BaseModel instances by model ID."""

    def create(self, model_id: str, channel: ProgressChannel | None = None) -> "BaseModel":
        """Return a constructed but not-yet-loaded model instance.

        Args:
            model_id: Key from ``models.yaml``.
            channel: Progress channel injected into the model at construction.

        Returns:
            A concrete :class:`~src.benchmark.base.BaseModel` that has not
            yet had ``.load()`` called.
        """
        ...


@runtime_checkable
class ResultStore(Protocol):
    """Persists and retrieves benchmark result dicts."""

    def save(self, result: dict) -> str:
        """Persist a result dict and return its unique result ID."""
        ...

    def list(self) -> list[dict]:
        """Return metadata for all stored results, newest first."""
        ...

    def get(self, result_id: str) -> dict:
        """Load and return a result dict by its ID.

        Raises:
            FileNotFoundError: If no result with ``result_id`` exists.
        """
        ...


@runtime_checkable
class MemoryProvider(Protocol):
    """Reports current process memory usage."""

    def current_rss(self) -> int:
        """Return current process RSS in bytes."""
        ...