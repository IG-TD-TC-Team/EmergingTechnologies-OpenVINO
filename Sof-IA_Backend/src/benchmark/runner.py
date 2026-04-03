"""Benchmark runner — warm-up / timed loops, memory capture, channel progress.

Sync entry point (CLI)::

    result = run_benchmark_sync(model_id, prompt, channel=PrintProgressChannel())

Async entry point (web server)::

    ch = QueueProgressChannel(queue, loop, job_id)
    result = await run_benchmark_async(model_id, prompt, channel=ch)

The async variant delegates the blocking work to a thread-pool executor so
the FastAPI event loop is never blocked.  Progress events are pushed through
the injected :class:`~src.benchmark.protocols.ProgressChannel`.

Injectable dependencies (S8)
-----------------------------
``model_provider``, ``result_store``, and ``memory_provider`` default to the
standard concrete implementations.  Pass alternatives in tests or future
multi-worker setups without touching this file.
"""

import asyncio
import logging
import time
from typing import Optional

import psutil

from src.benchmark.base import ASRBase, StreamingASRBase, StreamingSLMBase
from src.benchmark.factory import ModelFactory
from src.benchmark.metrics import (
    asr_chunk_latency,
    inter_token_latency,
    memory_delta_mb,
    time_to_first_token,
)
from src.benchmark.protocols import MemoryProvider, ModelProvider, ProgressChannel, ResultStore
from src.benchmark.repository import ResultRepository

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Default concrete implementations of injectable protocols
# ---------------------------------------------------------------------------

class _PsutilMemoryProvider:
    """Default MemoryProvider backed by psutil."""

    def current_rss(self) -> int:
        return psutil.Process().memory_info().rss


class _DefaultModelFactory:
    """Thin wrapper that satisfies the ModelProvider protocol."""

    def create(self, model_id: str, channel: Optional[ProgressChannel] = None):
        return ModelFactory.create(model_id, channel=channel)


# ---------------------------------------------------------------------------
# Sync runner
# ---------------------------------------------------------------------------

def run_benchmark_sync(
    model_id: str,
    input_data: str,
    warmup_runs: int = 3,
    timed_runs: int = 10,
    reference_transcript: Optional[str] = None,
    channel: Optional[ProgressChannel] = None,
    save: bool = True,
    job_id: str = "-",
    model_provider: Optional[ModelProvider] = None,
    result_store: Optional[ResultStore] = None,
    memory_provider: Optional[MemoryProvider] = None,
) -> dict:
    """Run a benchmark synchronously — intended for the CLI.

    Loads the model, runs warm-up and timed loops via the model's own
    ``_run_benchmark`` template method, unloads, and optionally persists
    the result.

    Args:
        model_id: Key from ``models.yaml`` (e.g. ``"phi3_pytorch"``).
        input_data: Prompt text for SLM models, or absolute path to an
            audio file for ASR models.
        warmup_runs: Number of warm-up runs whose timings are discarded.
        timed_runs: Number of timed runs to measure.
        reference_transcript: Ground-truth text for WER computation
            (ASR only).  ``None`` skips WER.
        channel: Progress channel for status updates.  ``None`` disables
            all progress reporting.
        save: If ``True``, persist the result via ``result_store``.
        job_id: Correlation ID attached to all log entries for this run.
        model_provider: Provides model instances.  Defaults to
            :class:`ModelFactory`.
        result_store: Persists result dicts.  Defaults to
            :class:`~src.benchmark.repository.ResultRepository`.
        memory_provider: Reports current RSS.  Defaults to
            :class:`_PsutilMemoryProvider`.

    Returns:
        Full benchmark result dict with keys ``model_id``, ``warmup_runs``,
        ``timed_runs``, and ``metrics``.  When ``save=True`` a ``result_id``
        key is added.

    Raises:
        TypeError: If the model does not implement ``_run_benchmark``
            (i.e. it extends :class:`~src.benchmark.base.BaseModel` directly
            without going through ``SLMBase`` or ``ASRBase``).
    """
    provider = model_provider or _DefaultModelFactory()
    store = result_store or ResultRepository()
    mem = memory_provider or _PsutilMemoryProvider()

    logger.info(
        "benchmark_start model_id=%s warmup=%d timed=%d",
        model_id, warmup_runs, timed_runs,
        extra={"job_id": job_id},
    )

    if channel:
        channel.send_progress(f"loading {model_id}")

    model = None
    rss_before_load = mem.current_rss()
    try:
        model = provider.create(model_id, channel=channel)
        model._job_id = job_id
        model.load()
        load_memory_mb = memory_delta_mb(rss_before_load, mem.current_rss())
        # Template method dispatch — no isinstance check needed
        metrics = model._run_benchmark(
            input_data, warmup_runs, timed_runs, rss_before_load, reference_transcript
        )
        metrics["load_memory_mb"] = load_memory_mb
    except Exception:
        logger.exception("benchmark_failed model_id=%s", model_id, extra={"job_id": job_id})
        if channel:
            channel.send_error(f"benchmark failed for {model_id}")
        raise
    finally:
        if channel:
            channel.send_progress("unloading model")
        if model is not None:
            model.unload()

    result = {
        "model_id": model_id,
        "warmup_runs": warmup_runs,
        "timed_runs": timed_runs,
        "metrics": metrics,
    }

    # Attach audio path so the UI can replay from history
    if isinstance(model, ASRBase):
        result["audio_path"] = input_data

    if save:
        result_id = store.save(result)
        result["result_id"] = result_id
        logger.info("result_saved result_id=%s", result_id, extra={"job_id": job_id})
        if channel:
            channel.send_progress(f"saved -> {result_id}")

    return result


# ---------------------------------------------------------------------------
# Async wrapper (web server)
# ---------------------------------------------------------------------------

async def run_benchmark_async(
    model_id: str,
    input_data: str,
    warmup_runs: int = 3,
    timed_runs: int = 10,
    reference_transcript: Optional[str] = None,
    channel: Optional[ProgressChannel] = None,
    save: bool = True,
    job_id: str = "-",
    model_provider: Optional[ModelProvider] = None,
    result_store: Optional[ResultStore] = None,
    memory_provider: Optional[MemoryProvider] = None,
) -> dict:
    """Run a benchmark asynchronously — intended for the FastAPI web server.

    Delegates the blocking benchmark work to a thread-pool executor so the
    event loop is never blocked.  Progress events are pushed through
    ``channel``; a final ``send_done`` call is made when complete.

    Args:
        model_id: Key from ``models.yaml``.
        input_data: Prompt text (SLM) or audio file path (ASR).
        warmup_runs: Number of warm-up runs to discard.
        timed_runs: Number of timed runs to measure.
        reference_transcript: Ground-truth text for WER (ASR only).
        channel: Progress channel.  ``None`` disables progress streaming.
        save: If ``True``, persist the result.
        job_id: Correlation ID for log entries.
        model_provider: Injectable model provider.
        result_store: Injectable result store.
        memory_provider: Injectable memory provider.

    Returns:
        Full benchmark result dict (same structure as
        :func:`run_benchmark_sync`).
    """
    loop = asyncio.get_event_loop()

    result = await loop.run_in_executor(
        None,
        lambda: run_benchmark_sync(
            model_id=model_id,
            input_data=input_data,
            warmup_runs=warmup_runs,
            timed_runs=timed_runs,
            reference_transcript=reference_transcript,
            channel=channel,
            save=save,
            job_id=job_id,
            model_provider=model_provider,
            result_store=result_store,
            memory_provider=memory_provider,
        ),
    )

    if channel is not None:
        channel.send_done(result)

    return result


# ---------------------------------------------------------------------------
# Phase 2 — Live / streaming runner functions
# ---------------------------------------------------------------------------

async def run_live_slm_async(
    model_id: str,
    prompt: str,
    channel: Optional[ProgressChannel] = None,
    job_id: str = "-",
    save: bool = True,
    model_provider: Optional[ModelProvider] = None,
    result_store: Optional[ResultStore] = None,
    memory_provider: Optional[MemoryProvider] = None,
) -> dict:
    """Stream token-by-token SLM output and compute TTFT + ITL metrics.

    The model must extend :class:`~src.benchmark.base.StreamingSLMBase`.
    Token events are pushed through ``channel.send_token()`` as they arrive.
    A final ``channel.send_done()`` is called with the full result dict.

    Args:
        model_id: Key from ``models.yaml``.
        prompt: Full formatted prompt string.
        channel: Progress channel.  Receives ``send_token`` for each token
            and ``send_done`` with the final result.
        job_id: Correlation ID for log entries.
        save: If ``True``, persist the result via ``result_store``.
        model_provider: Injectable model provider.
        result_store: Injectable result store.
        memory_provider: Injectable memory provider.

    Returns:
        Live result dict with ``mode="live"``, ``model_id``, and ``metrics``
        containing ``ttft_ms``, ``inter_token_latency``, ``peak_memory_mb``,
        ``full_text``, and ``total_tokens``.

    Raises:
        TypeError: If the model does not extend ``StreamingSLMBase``.
    """
    provider = model_provider or _DefaultModelFactory()
    store = result_store or ResultRepository()
    mem = memory_provider or _PsutilMemoryProvider()
    loop = asyncio.get_event_loop()

    logger.info("live_slm_start model_id=%s", model_id, extra={"job_id": job_id})

    def _run() -> dict:
        model = provider.create(model_id, channel=channel)
        model._job_id = job_id

        if not isinstance(model, StreamingSLMBase):
            raise TypeError(
                f"Model '{model_id}' does not support streaming — "
                "it must extend StreamingSLMBase."
            )

        if channel:
            channel.send_progress(f"loading {model_id}")

        rss_before_load = mem.current_rss()
        try:
            model.load()
        except Exception:
            logger.exception("load_failed model_id=%s", model_id, extra={"job_id": job_id})
            if channel:
                channel.send_error(f"load failed for {model_id}")
            raise

        try:
            t_start = time.perf_counter()
            gen = model.run_streaming(prompt)

            token_abs_times_ms: list[float] = []
            ttft_ms: Optional[float] = None
            idx = 0

            while True:
                try:
                    token = next(gen)
                    t_now = (time.perf_counter() - t_start) * 1000
                    if ttft_ms is None:
                        ttft_ms = t_now
                        logger.info(
                            "live_ttft_ms=%.1f model_id=%s", ttft_ms, model_id,
                            extra={"job_id": job_id},
                        )
                    token_abs_times_ms.append(t_now)
                    if channel:
                        channel.send_token(token, idx)
                    idx += 1
                except StopIteration as exc:
                    full_text, n_new_tokens = exc.value
                    break
        finally:
            model.unload()

        rss_peak = mem.current_rss()
        peak_memory_mb = memory_delta_mb(rss_before_load, rss_peak)

        metrics: dict = {
            "ttft_ms": round(ttft_ms, 2) if ttft_ms is not None else None,
            "peak_memory_mb": peak_memory_mb,
            "full_text": full_text,
            "total_tokens": n_new_tokens,
        }

        if len(token_abs_times_ms) >= 2:
            itl_times = [
                token_abs_times_ms[i] - token_abs_times_ms[i - 1]
                for i in range(1, len(token_abs_times_ms))
            ]
            metrics["inter_token_latency"] = inter_token_latency(itl_times)

        return {
            "mode": "live",
            "model_id": model_id,
            "metrics": metrics,
        }

    result = await loop.run_in_executor(None, _run)

    if save:
        result_id = store.save(result)
        result["result_id"] = result_id
        logger.info("live_result_saved result_id=%s", result_id, extra={"job_id": job_id})

    if channel:
        channel.send_done(result)

    return result


async def run_live_asr_async(
    model_id: str,
    audio_path: str,
    channel: Optional[ProgressChannel] = None,
    job_id: str = "-",
    chunk_ms: int = 500,
    save: bool = True,
    model_provider: Optional[ModelProvider] = None,
    result_store: Optional[ResultStore] = None,
    memory_provider: Optional[MemoryProvider] = None,
) -> dict:
    """Stream chunk-by-chunk ASR transcription and compute chunk latency metrics.

    The audio file is split into ``chunk_ms`` millisecond windows, each fed
    to the model's ``transcribe_stream()`` generator.  Partial transcript
    events are pushed through ``channel.send_chunk()`` after each chunk.

    Args:
        model_id: Key from ``models.yaml``.
        audio_path: Absolute path to the audio file (``.wav`` / ``.mp3``).
        channel: Progress channel.  Receives ``send_chunk`` per chunk and
            ``send_done`` with the final result.
        job_id: Correlation ID for log entries.
        chunk_ms: Audio window size in milliseconds (default 500ms).
        save: If ``True``, persist the result via ``result_store``.
        model_provider: Injectable model provider.
        result_store: Injectable result store.
        memory_provider: Injectable memory provider.

    Returns:
        Live result dict with ``mode="live"``, ``model_id``, and ``metrics``
        containing ``chunk_latency``, ``peak_memory_mb``, and ``full_transcript``.

    Raises:
        TypeError: If the model does not extend ``StreamingASRBase``.
    """
    provider = model_provider or _DefaultModelFactory()
    store = result_store or ResultRepository()
    mem = memory_provider or _PsutilMemoryProvider()
    loop = asyncio.get_event_loop()

    logger.info(
        "live_asr_start model_id=%s chunk_ms=%d", model_id, chunk_ms,
        extra={"job_id": job_id},
    )

    def _run() -> dict:
        import soundfile as sf
        import numpy as np

        model = provider.create(model_id, channel=channel)
        model._job_id = job_id

        if not isinstance(model, StreamingASRBase):
            raise TypeError(
                f"Model '{model_id}' does not support streaming ASR — "
                "it must extend StreamingASRBase."
            )

        if channel:
            channel.send_progress(f"loading {model_id}")

        rss_before_load = mem.current_rss()
        try:
            model.load()
        except Exception:
            logger.exception("load_failed model_id=%s", model_id, extra={"job_id": job_id})
            if channel:
                channel.send_error(f"load failed for {model_id}")
            raise

        try:
            audio, sample_rate = sf.read(audio_path, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)

            chunk_samples = int(sample_rate * chunk_ms / 1000)

            def _chunks():
                for start in range(0, len(audio), chunk_samples):
                    yield (audio[start:start + chunk_samples].tobytes(), sample_rate)

            t_start = time.perf_counter()
            gen = model.transcribe_stream(_chunks())
            chunk_abs_times_ms: list[float] = []
            idx = 0

            while True:
                try:
                    partial = next(gen)
                    t_now = (time.perf_counter() - t_start) * 1000
                    chunk_abs_times_ms.append(t_now)
                    if channel:
                        channel.send_chunk(partial, idx)
                    idx += 1
                except StopIteration as exc:
                    full_transcript = exc.value
                    break
        finally:
            model.unload()

        rss_peak = mem.current_rss()
        peak_memory_mb = memory_delta_mb(rss_before_load, rss_peak)

        metrics: dict = {
            "peak_memory_mb": peak_memory_mb,
            "full_transcript": full_transcript,
        }

        if chunk_abs_times_ms:
            metrics["chunk_latency"] = asr_chunk_latency(chunk_abs_times_ms)

        return {
            "mode": "live",
            "model_id": model_id,
            "metrics": metrics,
        }

    result = await loop.run_in_executor(None, _run)

    if save:
        result_id = store.save(result)
        result["result_id"] = result_id
        logger.info("live_result_saved result_id=%s", result_id, extra={"job_id": job_id})

    if channel:
        channel.send_done(result)

    return result