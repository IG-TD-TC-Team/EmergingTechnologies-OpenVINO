"""Metrics helpers for the benchmark runner.

Batch functions
---------------
- :func:`latency_stats` — mean, p50, p95 from a list of ms timings
- :func:`ms_per_token_stats` — throughput stats for SLM runs (includes tokens/sec)
- :func:`memory_delta_mb` — peak RSS delta in MB
- :func:`compute_wer` — Word Error Rate via ``jiwer`` (ASR only)
- :func:`asr_throughput` — Real-Time Factor and words/sec for ASR runs

Streaming functions (Phase 2)
------------------------------
- :func:`time_to_first_token` — TTFT from generation start to first token
- :func:`inter_token_latency` — ITL stats from a list of inter-token intervals
- :func:`asr_chunk_latency` — chunk processing latency stats for streaming ASR
"""

import statistics
from typing import Optional


def latency_stats(times_ms: list[float]) -> dict:
    """Compute summary statistics from a list of per-run latencies.

    Args:
        times_ms: Wall-clock durations in milliseconds, one per timed run.

    Returns:
        A dict with keys ``mean_ms``, ``p50_ms``, ``p95_ms``,
        ``min_ms``, ``max_ms``, and ``n``.

    Raises:
        ValueError: If ``times_ms`` is empty.
    """
    if not times_ms:
        raise ValueError("times_ms must not be empty")

    sorted_times = sorted(times_ms)
    n = len(sorted_times)

    def percentile(data: list[float], p: float) -> float:
        idx = (p / 100) * (len(data) - 1)
        lo = int(idx)
        hi = min(lo + 1, len(data) - 1)
        return data[lo] + (data[hi] - data[lo]) * (idx - lo)

    return {
        "mean_ms": statistics.mean(times_ms),
        "p50_ms": percentile(sorted_times, 50),
        "p95_ms": percentile(sorted_times, 95),
        "min_ms": sorted_times[0],
        "max_ms": sorted_times[-1],
        "n": n,
    }


def ms_per_token_stats(times_ms: list[float], token_counts: list[int]) -> dict:
    """Compute ms/token statistics for SLM runs.

    Args:
        times_ms: Wall-clock durations in milliseconds, one per timed run.
        token_counts: Number of new tokens generated per run.

    Returns:
        A dict with keys ``mean_ms_per_token``, ``p50_ms_per_token``,
        and ``p95_ms_per_token``.

    Raises:
        ValueError: If ``times_ms`` and ``token_counts`` differ in length,
            or if all token counts are zero.
    """
    if len(times_ms) != len(token_counts):
        raise ValueError("times_ms and token_counts must have the same length")

    per_token = [
        t / c for t, c in zip(times_ms, token_counts) if c > 0
    ]

    if not per_token:
        raise ValueError("All token counts were zero")

    sorted_pt = sorted(per_token)

    def percentile(data: list[float], p: float) -> float:
        idx = (p / 100) * (len(data) - 1)
        lo = int(idx)
        hi = min(lo + 1, len(data) - 1)
        return data[lo] + (data[hi] - data[lo]) * (idx - lo)

    mean_mpt = statistics.mean(per_token)
    return {
        "mean_ms_per_token": mean_mpt,
        "p50_ms_per_token": percentile(sorted_pt, 50),
        "p95_ms_per_token": percentile(sorted_pt, 95),
        "mean_tokens_per_sec": round(1000.0 / mean_mpt, 2) if mean_mpt > 0 else 0.0,
    }


def memory_delta_mb(rss_before_bytes: int, rss_peak_bytes: int) -> float:
    """Compute RSS memory increase in MB.

    Args:
        rss_before_bytes: Resident set size in bytes before the run.
        rss_peak_bytes: Peak RSS in bytes during or after the run.

    Returns:
        Delta in megabytes, clamped to ``0.0`` (never negative).
    """
    delta = rss_peak_bytes - rss_before_bytes
    return max(0.0, delta / (1024 * 1024))


def asr_throughput(times_ms: list[float], transcript: str, audio_duration_s: float) -> dict:
    """Compute ASR throughput metrics: Real-Time Factor and words per second.

    Args:
        times_ms: Wall-clock durations in milliseconds, one per timed run.
        transcript: Last decoded transcript — used to count output words.
        audio_duration_s: Duration of the audio clip in seconds.

    Returns:
        A dict with keys ``rtf`` (Real-Time Factor, lower is better),
        ``words_per_sec`` (higher is better), and ``audio_duration_s``.
        ``rtf`` is ``None`` if ``audio_duration_s`` is zero.
        ``words_per_sec`` is ``None`` if the transcript is empty.

    Raises:
        ValueError: If ``times_ms`` is empty.
    """
    if not times_ms:
        raise ValueError("times_ms must not be empty")

    mean_latency_s = statistics.mean(times_ms) / 1000.0
    word_count = len(transcript.split()) if transcript and transcript.strip() else 0

    rtf = round(mean_latency_s / audio_duration_s, 3) if audio_duration_s > 0 else None
    words_per_sec = (
        round(word_count / mean_latency_s, 2)
        if mean_latency_s > 0 and word_count > 0
        else None
    )

    return {
        "audio_duration_s": round(audio_duration_s, 2),
        "rtf": rtf,
        "words_per_sec": words_per_sec,
    }


def time_to_first_token(first_token_ms: float) -> dict:
    """Return a dict with the time-to-first-token measurement.

    Args:
        first_token_ms: Elapsed milliseconds from generation start to the
            first yielded token.

    Returns:
        ``{"ttft_ms": float}`` rounded to two decimal places.
    """
    return {"ttft_ms": round(first_token_ms, 2)}


def inter_token_latency(itl_times_ms: list[float]) -> dict:
    """Compute inter-token latency statistics for a streaming SLM run.

    Args:
        itl_times_ms: List of intervals between consecutive tokens in
            milliseconds.  Length is ``total_tokens - 1``.

    Returns:
        A dict with keys ``mean_itl_ms``, ``p50_itl_ms``, ``p95_itl_ms``,
        ``tokens_per_sec``, and ``total_tokens``.

    Raises:
        ValueError: If ``itl_times_ms`` is empty.
    """
    if not itl_times_ms:
        raise ValueError("itl_times_ms must not be empty")

    sorted_itl = sorted(itl_times_ms)
    n = len(sorted_itl)

    def percentile(data: list[float], p: float) -> float:
        idx = (p / 100) * (len(data) - 1)
        lo = int(idx)
        hi = min(lo + 1, len(data) - 1)
        return data[lo] + (data[hi] - data[lo]) * (idx - lo)

    mean_itl = statistics.mean(itl_times_ms)
    tokens_per_sec = round(1000.0 / mean_itl, 2) if mean_itl > 0 else 0.0

    return {
        "mean_itl_ms": round(mean_itl, 2),
        "p50_itl_ms": round(percentile(sorted_itl, 50), 2),
        "p95_itl_ms": round(percentile(sorted_itl, 95), 2),
        "tokens_per_sec": tokens_per_sec,
        "total_tokens": n + 1,  # intervals = tokens - 1
    }


def asr_chunk_latency(chunk_times_ms: list[float]) -> dict:
    """Compute chunk processing latency statistics for a streaming ASR run.

    Args:
        chunk_times_ms: List of elapsed times in milliseconds from stream
            start to when each chunk's partial transcript was yielded.

    Returns:
        A dict with keys ``mean_chunk_ms`` and ``p95_chunk_ms``.

    Raises:
        ValueError: If ``chunk_times_ms`` is empty.
    """
    if not chunk_times_ms:
        raise ValueError("chunk_times_ms must not be empty")

    sorted_chunks = sorted(chunk_times_ms)

    def percentile(data: list[float], p: float) -> float:
        idx = (p / 100) * (len(data) - 1)
        lo = int(idx)
        hi = min(lo + 1, len(data) - 1)
        return data[lo] + (data[hi] - data[lo]) * (idx - lo)

    return {
        "mean_chunk_ms": round(statistics.mean(chunk_times_ms), 2),
        "p95_chunk_ms": round(percentile(sorted_chunks, 95), 2),
    }


def compute_wer(reference: str, hypothesis: str) -> Optional[float]:
    """Compute Word Error Rate using ``jiwer``.

    Both strings are normalized before comparison: lowercased, punctuation
    stripped, and whitespace collapsed.  This is required because LibriSpeech
    references are UPPERCASE while Whisper outputs mixed-case text with
    punctuation — without normalization every word would mismatch (100% WER).

    Args:
        reference: Ground-truth transcript (any casing, with or without punctuation).
        hypothesis: Model output transcript.

    Returns:
        WER as a fraction (``0.0`` = perfect), or ``None`` if ``jiwer``
        is not installed.
    """
    import re

    def _normalize(text: str) -> str:
        text = text.lower()
        text = re.sub(r"[^\w\s]", "", text)   # remove punctuation
        text = " ".join(text.split())          # collapse whitespace
        return text

    try:
        import jiwer
        return jiwer.wer(_normalize(reference), _normalize(hypothesis))
    except ImportError:
        return None
