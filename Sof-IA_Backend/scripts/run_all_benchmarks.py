#!/usr/bin/env python3
"""
Standardized benchmark runner — runs all enabled models with the same inputs
and prints a side-by-side comparison table.

Usage:
    python scripts/run_all_benchmarks.py
    python scripts/run_all_benchmarks.py --warmup 2 --timed 5
    python scripts/run_all_benchmarks.py --no-save --models phi3_openvino,whisper_pytorch

Inputs are loaded from config/models.yaml (benchmark.slm_prompt_file,
benchmark.asr_audio_file, benchmark.asr_reference_file).
Run scripts/setup_benchmark_data.py once before using this script.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import yaml

from src.benchmark.channels import PrintProgressChannel
from src.benchmark.runner import run_benchmark_sync
from src.benchmark.factory import ModelFactory
from src.benchmark.base import SLMBase, ASRBase


_CONFIG_PATH = Path("config/models.yaml")


def _load_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _check_inputs(cfg: dict) -> tuple[str, str, str]:
    """Resolve and validate standard input files. Returns (prompt, audio_path, reference)."""
    bench = cfg.get("benchmark", {})

    prompt_file = Path(bench.get("slm_prompt_file", ""))
    audio_file  = Path(bench.get("asr_audio_file", ""))
    ref_file    = Path(bench.get("asr_reference_file", ""))

    missing = [p for p in [prompt_file, audio_file, ref_file] if not p.exists()]
    if missing:
        print("ERROR: Missing benchmark input files:")
        for p in missing:
            print(f"  {p}")
        if audio_file in missing:
            print("\nRun:  python scripts/setup_benchmark_data.py")
        sys.exit(1)

    prompt    = prompt_file.read_text(encoding="utf-8").strip()
    reference = ref_file.read_text(encoding="utf-8").strip()
    return prompt, str(audio_file), reference


def _fmt(value, decimals: int = 1, unit: str = "") -> str:
    if value is None:
        return "—"
    return f"{value:.{decimals}f}{unit}"


def _print_table(rows: list[dict]) -> None:
    slm_rows = [r for r in rows if r["type"] == "slm"]
    asr_rows = [r for r in rows if r["type"] == "asr"]

    SEP = "-" * 68

    if slm_rows:
        print("\n-- SLM Results " + "-" * 53)
        header = f"{'Model':<22} {'Status':<10} {'Mean (ms)':>12} {'ms/token':>10} {'Mem dMB':>10}"
        print(header)
        print(SEP)
        for r in slm_rows:
            m = r.get("metrics", {})
            lat = m.get("latency", {})
            mpt = m.get("ms_per_token", {})
            print(
                f"{r['model_id']:<22} {r['status']:<10} "
                f"{_fmt(lat.get('mean_ms'), 0, ' ms'):>12} "
                f"{_fmt(mpt.get('mean_ms_per_token'), 1, ' ms'):>10} "
                f"{_fmt(m.get('peak_memory_mb'), 0, ' MB'):>10}"
            )

    if asr_rows:
        print("\n-- ASR Results " + "-" * 53)
        header = f"{'Model':<22} {'Status':<10} {'Mean (ms)':>12} {'WER':>8} {'Mem dMB':>10}"
        print(header)
        print(SEP)
        for r in asr_rows:
            m = r.get("metrics", {})
            lat = m.get("latency", {})
            wer = m.get("wer")
            wer_str = f"{wer*100:.1f}%" if wer is not None else "n/a"
            print(
                f"{r['model_id']:<22} {r['status']:<10} "
                f"{_fmt(lat.get('mean_ms'), 0, ' ms'):>12} "
                f"{wer_str:>8} "
                f"{_fmt(m.get('peak_memory_mb'), 0, ' MB'):>10}"
            )

    if any(r["status"] == "ERROR" for r in rows):
        print("\n-- Errors " + "-" * 58)
        for r in rows:
            if r["status"] == "ERROR":
                print(f"  {r['model_id']}: {r.get('error')}")


def main() -> None:
    cfg = _load_config()
    bench_defaults = cfg.get("benchmark", {})

    parser = argparse.ArgumentParser(description="Run all models with standardized inputs.")
    parser.add_argument(
        "--warmup", type=int, default=bench_defaults.get("warmup_runs", 2),
        help="Warm-up runs (default: from config)"
    )
    parser.add_argument(
        "--timed", type=int, default=bench_defaults.get("timed_runs", 5),
        help="Timed runs (default: from config)"
    )
    parser.add_argument(
        "--models", default=None,
        help="Comma-separated model IDs to run (default: all enabled)"
    )
    parser.add_argument("--no-save", action="store_true", help="Skip saving results to disk")
    parser.add_argument("--json", action="store_true", help="Print raw JSON instead of table")
    args = parser.parse_args()

    prompt, audio_path, reference = _check_inputs(cfg)

    model_ids = (
        [m.strip() for m in args.models.split(",")]
        if args.models
        else ModelFactory.available()
    )

    print(f"Benchmark: {len(model_ids)} model(s)  warmup={args.warmup}  timed={args.timed}")
    print(f"SLM prompt: {len(prompt.split())} words")
    print(f"ASR audio:  {audio_path}")
    print(f"ASR ref:    {len(reference.split())} words\n")

    rows: list[dict] = []

    for model_id in model_ids:
        print(f"[{model_id}] starting...")

        # Determine model type before creating (to pick the right input)
        try:
            model_instance = ModelFactory.create(model_id)
        except Exception as exc:
            print(f"[{model_id}] SKIP — factory error: {exc}")
            rows.append({"model_id": model_id, "type": "unknown", "status": "ERROR", "error": str(exc)})
            continue

        is_slm = isinstance(model_instance, SLMBase)
        is_asr = isinstance(model_instance, ASRBase)
        model_type = "slm" if is_slm else "asr" if is_asr else "unknown"
        input_data = prompt if is_slm else audio_path

        try:
            result = run_benchmark_sync(
                model_id=model_id,
                input_data=input_data,
                warmup_runs=args.warmup,
                timed_runs=args.timed,
                reference_transcript=reference if is_asr else None,
                channel=PrintProgressChannel(model_id),
                save=not args.no_save,
            )
            rows.append({
                "model_id": model_id,
                "type": model_type,
                "status": "OK",
                "metrics": result.get("metrics", {}),
                "result_id": result.get("result_id"),
            })
            print(f"[{model_id}] done.\n")
        except Exception as exc:
            print(f"[{model_id}] FAILED: {exc}\n")
            rows.append({"model_id": model_id, "type": model_type, "status": "ERROR", "error": str(exc)})

    if args.json:
        print(json.dumps(rows, indent=2))
    else:
        _print_table(rows)


if __name__ == "__main__":
    main()
