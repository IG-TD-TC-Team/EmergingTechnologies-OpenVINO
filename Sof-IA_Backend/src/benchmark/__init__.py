"""Benchmark engine for the OpenVino local AI inference pipeline.

This package provides the full benchmark lifecycle:

- **base**: Abstract base classes (`BaseModel`, `SLMBase`, `ASRBase`)
- **factory**: `ModelFactory` — instantiates models from ``config/models.yaml``
- **runner**: `run_benchmark_sync` / `run_benchmark_async` — warm-up + timed loops
- **metrics**: Latency stats, ms/token, memory delta, WER helpers
- **repository**: `ResultRepository` — persists and retrieves result JSON files
- **report**: `generate_report` — produces a Markdown summary from a result dict

Typical usage::

    from src.benchmark.runner import run_benchmark_sync

    result = run_benchmark_sync("phi3_pytorch", prompt="Hello, world!")
"""
