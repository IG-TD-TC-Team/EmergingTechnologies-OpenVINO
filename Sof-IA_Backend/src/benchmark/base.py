"""Abstract base classes for the benchmark OOP hierarchy.

Hierarchy::

    BaseModel  (ABC)
    ├── SLMBase  (ABC)  — text-in / text-out, ms/token metric
    └── ASRBase  (ABC)  — audio-in / text-out, WER metric
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Generator, Iterator, Optional

if TYPE_CHECKING:
    from src.benchmark.protocols import ProgressChannel

logger = logging.getLogger(__name__)


class BaseModel(ABC):
    """Common interface that the runner uses for every model.

    Concrete classes must implement :meth:`load`, :meth:`run`, and
    :meth:`unload`.
    """

    def __init__(
        self,
        model_id: str,
        model_path: str,
        channel: "ProgressChannel | None" = None,
    ):
        """Initialize the base model with registry key, weights path, and channel.

        Args:
            model_id: Registry key from ``models.yaml`` (e.g. ``"phi3_pytorch"``).
            model_path: Filesystem path or HuggingFace hub ID for the model weights.
            channel: Progress channel for reporting events during load/run.
                ``None`` disables all progress reporting.
        """
        self.model_id = model_id
        self.model_path = model_path
        self._channel = channel
        self._job_id: str = "-"

    def _report(self, msg: str) -> None:
        """Log ``msg`` at INFO and forward it to the channel.

        Structured log entries include ``job_id`` for per-job log correlation.

        Args:
            msg: Human-readable status message (e.g. ``"downloading model..."``).
        """
        logger.info(msg, extra={"job_id": self._job_id})
        if self._channel is not None:
            self._channel.send_progress(msg)

    @abstractmethod
    def load(self) -> None:
        """Load model weights and tokenizer into memory."""

    @abstractmethod
    def run(self, input_data) -> str:
        """Run one inference pass.

        Args:
            input_data: Prompt string for :class:`SLMBase`, or path to an
                audio file for :class:`ASRBase`.

        Returns:
            Generated text output.
        """

    @abstractmethod
    def unload(self) -> None:
        """Release model weights and free memory."""

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(model_id={self.model_id!r})"


class SLMBase(BaseModel, ABC):
    """Base class for Small Language Models.

    Extends :class:`BaseModel` with:

    - ``max_new_tokens`` parameter passed through to :meth:`run`
    - token count returned alongside text so the runner can compute ms/token
    - :meth:`_run_benchmark` template method encapsulating the warm-up /
      timed loop so the runner needs no ``isinstance`` dispatch
    """

    def __init__(
        self,
        model_id: str,
        model_path: str,
        max_new_tokens: int = 512,
        channel: "ProgressChannel | None" = None,
    ):
        """Initialize the SLM base.

        Args:
            model_id: Registry key from ``models.yaml``.
            model_path: Filesystem path or HuggingFace hub ID for weights.
            max_new_tokens: Maximum number of tokens to generate per call.
            channel: Progress channel injected at construction.
        """
        super().__init__(model_id, model_path, channel)
        self.max_new_tokens = max_new_tokens

    @abstractmethod
    def run(self, prompt: str) -> tuple[str, int]:
        """Run one inference pass and return text with its token count.

        Args:
            prompt: Full formatted prompt string.

        Returns:
            A tuple ``(generated_text, number_of_new_tokens_generated)``.
        """

    def _run_benchmark(
        self,
        input_data: str,
        warmup_runs: int,
        timed_runs: int,
        rss_before_load: int,
        reference_transcript: Optional[str] = None,  # ignored for SLM
    ) -> dict:
        """Execute warm-up and timed loops for this SLM.

        Called by the runner — no ``isinstance`` check needed at the call site.

        Args:
            input_data: Prompt string passed to each :meth:`run` call.
            warmup_runs: Number of warm-up iterations whose timings are discarded.
            timed_runs: Number of iterations to measure.
            rss_before_load: RSS in bytes captured before :meth:`load` was
                called; used to compute ``peak_memory_mb``.
            reference_transcript: Ignored for SLM; accepted so the runner can
                call ``_run_benchmark`` uniformly across model types.

        Returns:
            Partial result dict with keys ``latency``, ``ms_per_token``,
            and ``peak_memory_mb``.
        """
        from src.benchmark.metrics import latency_stats, ms_per_token_stats, memory_delta_mb
        import psutil

        def _rss() -> int:
            return psutil.Process().memory_info().rss

        for i in range(warmup_runs):
            self._report(f"warmup {i + 1}/{warmup_runs}")
            logger.debug("warmup %d/%d", i + 1, warmup_runs, extra={"job_id": self._job_id})
            self.run(input_data)

        rss_after_warmup = _rss()
        peak_memory_mb = memory_delta_mb(rss_before_load, rss_after_warmup)

        times_ms: list[float] = []
        token_counts: list[int] = []

        for i in range(timed_runs):
            self._report(f"timed {i + 1}/{timed_runs}")
            t0 = time.perf_counter()
            _, n_tokens = self.run(input_data)
            elapsed_ms = (time.perf_counter() - t0) * 1000
            logger.debug(
                "timed run %d/%d elapsed_ms=%.1f",
                i + 1, timed_runs, elapsed_ms,
                extra={"job_id": self._job_id},
            )
            times_ms.append(elapsed_ms)
            token_counts.append(n_tokens)

        return {
            "latency": latency_stats(times_ms),
            "ms_per_token": ms_per_token_stats(times_ms, token_counts),
            "peak_memory_mb": peak_memory_mb,
        }


class ASRBase(BaseModel, ABC):
    """Base class for Automatic Speech Recognition models.

    Extends :class:`BaseModel` with audio file input instead of a text
    prompt and a :meth:`_run_benchmark` template method so the runner needs
    no ``isinstance`` dispatch.
    """

    @abstractmethod
    def run(self, audio_path: str) -> str:
        """Transcribe an audio file.

        Args:
            audio_path: Absolute path to the audio file (``.wav`` / ``.mp3``).

        Returns:
            Transcription text.
        """

    def _run_benchmark(
        self,
        input_data: str,
        warmup_runs: int,
        timed_runs: int,
        rss_before_load: int,
        reference_transcript: Optional[str] = None,
    ) -> dict:
        """Execute warm-up and timed loops for this ASR model.

        Called by the runner — no ``isinstance`` check needed at the call site.

        Args:
            input_data: Absolute path to the audio file passed to :meth:`run`.
            warmup_runs: Number of warm-up iterations whose timings are discarded.
            timed_runs: Number of iterations to measure.
            rss_before_load: RSS in bytes captured before :meth:`load` was
                called; used to compute ``peak_memory_mb``.
            reference_transcript: Ground-truth text for WER computation.
                ``None`` skips WER.

        Returns:
            Partial result dict with keys ``latency``, ``peak_memory_mb``,
            ``transcript``, and optionally ``wer``, ``audio_duration_s``,
            ``rtf``, ``words_per_sec``.
        """
        from src.benchmark.metrics import (
            latency_stats, memory_delta_mb, asr_throughput, compute_wer,
        )
        import psutil

        def _rss() -> int:
            return psutil.Process().memory_info().rss

        for i in range(warmup_runs):
            self._report(f"warmup {i + 1}/{warmup_runs}")
            logger.debug("warmup %d/%d", i + 1, warmup_runs, extra={"job_id": self._job_id})
            self.run(input_data)

        rss_after_warmup = _rss()
        peak_memory_mb = memory_delta_mb(rss_before_load, rss_after_warmup)

        times_ms: list[float] = []
        last_transcript: str = ""

        for i in range(timed_runs):
            self._report(f"timed {i + 1}/{timed_runs}")
            t0 = time.perf_counter()
            last_transcript = self.run(input_data)
            elapsed_ms = (time.perf_counter() - t0) * 1000
            logger.debug(
                "timed run %d/%d elapsed_ms=%.1f",
                i + 1, timed_runs, elapsed_ms,
                extra={"job_id": self._job_id},
            )
            times_ms.append(elapsed_ms)

        result = {
            "latency": latency_stats(times_ms),
            "peak_memory_mb": peak_memory_mb,
            "transcript": last_transcript,
        }

        try:
            import soundfile as sf
            audio_duration_s = sf.info(input_data).duration
            result.update(asr_throughput(times_ms, last_transcript, audio_duration_s))
        except Exception:
            logger.warning(
                "soundfile unavailable — throughput fields skipped",
                extra={"job_id": self._job_id},
            )

        if reference_transcript:
            wer = compute_wer(reference_transcript, last_transcript)
            if wer is not None:
                result["wer"] = wer

        return result


# ---------------------------------------------------------------------------
# Phase 2 — Streaming base classes
# ---------------------------------------------------------------------------

class StreamingSLMBase(SLMBase, ABC):
    """Extends :class:`SLMBase` with token-by-token streaming generation.

    Concrete classes implement :meth:`run_streaming` which is a generator
    that yields one decoded token string per iteration and returns
    ``(full_text, total_new_tokens)`` via ``StopIteration.value`` when
    generation is complete.

    The batch :meth:`run` method must still be implemented — it is used by
    the batch benchmark runner.  A default implementation that collects all
    tokens from :meth:`run_streaming` is provided for convenience but can
    be overridden.
    """

    @abstractmethod
    def run_streaming(self, prompt: str) -> Generator[str, None, tuple[str, int]]:
        """Yield tokens one by one and return ``(full_text, n_new_tokens)``.

        Args:
            prompt: Full formatted prompt string.

        Yields:
            Decoded token strings (one per generated token).

        Returns:
            ``(full_text, n_new_tokens)`` via ``StopIteration.value`` when
            generation is complete.  Callers must use ``next()`` in a
            ``while True / except StopIteration`` loop to retrieve this value.
        """


class AudioSLMBase(SLMBase, ABC):
    """Base class for Audio Language Models (audio + optional text prompt → text).

    Extends :class:`SLMBase` with an audio file as the primary input.
    ``run()`` takes ``(audio_path, prompt="")`` so that benchmark callers
    that pass a single string (the audio path) as ``input_data`` still work
    correctly via the default ``prompt=""``.
    """

    @abstractmethod
    def run(self, audio_path: str, prompt: str = "") -> tuple[str, int]:  # type: ignore[override]
        """Run one inference pass on the audio file.

        Args:
            audio_path: Absolute path to the audio file.
            prompt: Optional text instruction appended after audio tokens.

        Returns:
            ``(generated_text, n_new_tokens)``
        """

    @abstractmethod
    def run_streaming(self, audio_path: str, prompt: str = "") -> Generator[str, None, tuple[str, int]]:
        """Yield tokens one by one and return ``(full_text, n_new_tokens)``.

        Args:
            audio_path: Absolute path to the audio file.
            prompt: Optional text instruction.

        Yields:
            Decoded token strings (one per generated token).

        Returns:
            ``(full_text, n_new_tokens)`` via ``StopIteration.value``.
        """


class StreamingASRBase(ASRBase, ABC):
    """Extends :class:`ASRBase` with chunk-by-chunk streaming transcription.

    Concrete classes implement :meth:`transcribe_stream` which accepts an
    iterator of raw PCM audio chunks and yields cumulative partial transcript
    strings after each chunk.

    The batch :meth:`run` method must still be implemented and is used by
    the batch benchmark runner.
    """

    @abstractmethod
    def transcribe_stream(
        self,
        audio_chunks: Iterator[tuple[bytes, int]],
    ) -> Generator[str, None, str]:
        """Yield cumulative partial transcripts and return the full transcript.

        Args:
            audio_chunks: Iterator of ``(pcm_bytes, sample_rate)`` tuples.
                ``pcm_bytes`` is a raw float32 PCM byte string; ``sample_rate``
                is the sample rate in Hz (e.g. ``16000``).

        Yields:
            Cumulative partial transcript strings after each chunk.

        Returns:
            Final full transcript string via ``StopIteration.value``.
        """