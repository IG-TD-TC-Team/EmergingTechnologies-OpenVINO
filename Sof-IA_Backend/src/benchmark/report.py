"""Markdown report generator for benchmark results.

Takes the result dict produced by :func:`~src.benchmark.runner.run_benchmark_sync`
and returns a formatted Markdown string suitable for display or saving to disk.
"""

from datetime import datetime


def generate_report(result: dict) -> str:
    """Produce a human-readable Markdown summary from a benchmark result.

    The output includes a header table with run metadata, followed by
    optional sections for latency, ms/token throughput, memory delta,
    WER accuracy, and the last transcript — each section appears only
    when the corresponding data is present in ``result``.

    Args:
        result: Result dict as produced by
            :func:`~src.benchmark.runner.run_benchmark_sync`.

    Returns:
        Markdown-formatted report string.
    """
    model_id = result.get("model_id", "unknown")
    result_id = result.get("result_id", "—")
    warmup = result.get("warmup_runs", "?")
    timed = result.get("timed_runs", "?")
    metrics = result.get("metrics", {})

    lines = [
        f"# Benchmark Report",
        f"",
        f"| Field | Value |",
        f"|-------|-------|",
        f"| Model | `{model_id}` |",
        f"| Result ID | `{result_id}` |",
        f"| Warm-up runs | {warmup} |",
        f"| Timed runs | {timed} |",
        f"| Generated | {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC |",
        f"",
    ]

    latency = metrics.get("latency")
    if latency:
        lines += [
            "## Latency",
            "",
            "| Metric | Value |",
            "|--------|-------|",
            f"| Mean | {latency['mean_ms']:.1f} ms |",
            f"| p50  | {latency['p50_ms']:.1f} ms |",
            f"| p95  | {latency['p95_ms']:.1f} ms |",
            f"| Min  | {latency['min_ms']:.1f} ms |",
            f"| Max  | {latency['max_ms']:.1f} ms |",
            "",
        ]

    ms_per_token = metrics.get("ms_per_token")
    if ms_per_token:
        lines += [
            "## Throughput (SLM)",
            "",
            "| Metric | Value |",
            "|--------|-------|",
            f"| Mean ms/token | {ms_per_token['mean_ms_per_token']:.2f} ms/token |",
            f"| p50 ms/token  | {ms_per_token['p50_ms_per_token']:.2f} ms/token |",
            f"| p95 ms/token  | {ms_per_token['p95_ms_per_token']:.2f} ms/token |",
        ]
        if "mean_tokens_per_sec" in ms_per_token:
            lines.append(f"| Mean tokens/sec | {ms_per_token['mean_tokens_per_sec']:.2f} tok/s |")
        lines.append("")

    rtf = metrics.get("rtf")
    wps = metrics.get("words_per_sec")
    dur = metrics.get("audio_duration_s")
    if rtf is not None or wps is not None:
        lines += ["## Throughput (ASR)", "", "| Metric | Value |", "|--------|-------|"]
        if dur is not None:
            lines.append(f"| Audio duration | {dur:.2f} s |")
        if rtf is not None:
            lines.append(f"| Real-Time Factor (RTF) | **{rtf:.3f}** *(lower = faster than real-time)* |")
        if wps is not None:
            lines.append(f"| Words per second | {wps:.2f} w/s |")
        lines.append("")

    load_mem = metrics.get("load_memory_mb")
    peak_mem = metrics.get("peak_memory_mb")
    if load_mem is not None or peak_mem is not None:
        lines += ["## Memory", "", "| Metric | Value |", "|--------|-------|"]
        if peak_mem is not None:
            lines.append(f"| Peak working set | **{peak_mem:.1f} MB** |")
        if load_mem is not None:
            lines.append(f"| Model load RSS delta | {load_mem:.1f} MB |")
        lines.append("")

    wer = metrics.get("wer")
    if wer is not None:
        lines += [
            "## Accuracy (WER)",
            "",
            f"Word Error Rate: **{wer:.3f}** ({wer * 100:.1f}%)",
            "",
        ]

    transcript = metrics.get("transcript")
    if transcript:
        lines += [
            "## Transcript (last run)",
            "",
            "```",
            transcript,
            "```",
            "",
        ]

    return "\n".join(lines)
