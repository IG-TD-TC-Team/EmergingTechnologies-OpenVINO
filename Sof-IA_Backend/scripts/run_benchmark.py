#!/usr/bin/env python3
"""
CLI entry point for running benchmarks without the web server.

Subcommands
-----------
batch (default)
    python scripts/run_benchmark.py --model phi3_pytorch --prompt "Hello"
    python scripts/run_benchmark.py --model phi3_openvino --prompt-file data/prompts/clinical_note_prompt.txt
    python scripts/run_benchmark.py --model whisper_pytorch --audio data/samples/sample.wav

live-slm
    python scripts/run_benchmark.py live-slm --model phi3_openvino --prompt "Hello"
    python scripts/run_benchmark.py live-slm --model phi3_pytorch --prompt-file data/prompts/clinical_note_prompt.txt

live-asr
    python scripts/run_benchmark.py live-asr --model whisper_openvino --audio data/samples/sample.wav
    python scripts/run_benchmark.py live-asr --model whisper_openvino --audio data/samples/sample.wav --chunk-ms 1000

Batch options
    --model         Model ID from config/models.yaml (required)
    --prompt        Prompt string for SLM models
    --prompt-file   Path to a file containing the prompt
    --audio         Path to audio file for ASR models
    --warmup        Number of warm-up runs (default: from config)
    --timed         Number of timed runs (default: from config)
    --reference     Reference transcript for WER (ASR only)
    --no-save       Do not save result to disk
    --report        Print markdown report after run

Live options
    --model         Model ID from config/models.yaml (required)
    --prompt        Prompt string (live-slm only)
    --prompt-file   Path to file containing the prompt (live-slm only)
    --audio         Path to audio file (live-asr only)
    --chunk-ms      Audio chunk size in milliseconds (live-asr only, default: 500)
    --no-save       Do not save result to disk
"""

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

# Ensure project root is on the path when running from scripts/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import yaml
from src.benchmark.channels import PrintProgressChannel
from src.benchmark.report import generate_report
from src.benchmark.runner import run_benchmark_sync, run_live_slm_async, run_live_asr_async
from src.logging_config import setup_logging

logger = logging.getLogger(__name__)


def _load_benchmark_defaults() -> dict:
    config_path = Path(__file__).resolve().parents[1] / "config" / "models.yaml"
    with open(config_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    return cfg.get("benchmark", {})


# ---------------------------------------------------------------------------
# Batch subcommand
# ---------------------------------------------------------------------------

def _run_batch(args, defaults: dict) -> None:
    if args.audio:
        input_data = args.audio
    elif args.prompt_file:
        input_data = Path(args.prompt_file).read_text(encoding="utf-8").strip()
    elif args.prompt:
        input_data = args.prompt
    else:
        print("error: provide --prompt, --prompt-file, or --audio", file=sys.stderr)
        sys.exit(1)

    logger.info("cli_start model=%s warmup=%d timed=%d", args.model, args.warmup, args.timed)
    print(f"Running benchmark: {args.model}")
    print(f"  warm-up: {args.warmup}  timed: {args.timed}")
    print()

    result = run_benchmark_sync(
        model_id=args.model,
        input_data=input_data,
        warmup_runs=args.warmup,
        timed_runs=args.timed,
        reference_transcript=args.reference,
        channel=PrintProgressChannel(),
        save=not args.no_save,
    )

    print()
    if args.report:
        print(generate_report(result))
    else:
        print(json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# Live-SLM subcommand
# ---------------------------------------------------------------------------

def _run_live_slm(args) -> None:
    if args.prompt_file:
        prompt = Path(args.prompt_file).read_text(encoding="utf-8").strip()
    elif args.prompt:
        prompt = args.prompt
    else:
        print("error: provide --prompt or --prompt-file", file=sys.stderr)
        sys.exit(1)

    logger.info("cli_live_slm_start model=%s", args.model)
    print(f"Streaming SLM: {args.model}")
    print()

    channel = PrintProgressChannel()
    result = asyncio.run(
        run_live_slm_async(
            model_id=args.model,
            prompt=prompt,
            channel=channel,
            save=not args.no_save,
        )
    )

    print("\n")
    print(json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# Live-ASR subcommand
# ---------------------------------------------------------------------------

def _run_live_asr(args) -> None:
    if not args.audio:
        print("error: provide --audio", file=sys.stderr)
        sys.exit(1)

    logger.info("cli_live_asr_start model=%s chunk_ms=%d", args.model, args.chunk_ms)
    print(f"Streaming ASR: {args.model}  chunk={args.chunk_ms}ms")
    print()

    channel = PrintProgressChannel()
    result = asyncio.run(
        run_live_asr_async(
            model_id=args.model,
            audio_path=args.audio,
            channel=channel,
            chunk_ms=args.chunk_ms,
            save=not args.no_save,
        )
    )

    print("\n")
    print(json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def main() -> None:
    setup_logging()
    defaults = _load_benchmark_defaults()

    parser = argparse.ArgumentParser(
        description="OpenVino benchmark CLI.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="subcommand")

    # -- batch (default) --
    batch_p = subparsers.add_parser("batch", help="Run a batch benchmark (default)")
    batch_p.add_argument("--model", required=True)
    batch_p.add_argument("--prompt", default=None)
    batch_p.add_argument("--prompt-file", default=None)
    batch_p.add_argument("--audio", default=None)
    batch_p.add_argument("--warmup", type=int, default=defaults.get("warmup_runs", 3))
    batch_p.add_argument("--timed", type=int, default=defaults.get("timed_runs", 10))
    batch_p.add_argument("--reference", default=None)
    batch_p.add_argument("--no-save", action="store_true")
    batch_p.add_argument("--report", action="store_true")

    # legacy: allow batch flags directly on the root parser for backwards compat
    parser.add_argument("--model", default=None)
    parser.add_argument("--prompt", default=None)
    parser.add_argument("--prompt-file", default=None)
    parser.add_argument("--audio", default=None)
    parser.add_argument("--warmup", type=int, default=defaults.get("warmup_runs", 3))
    parser.add_argument("--timed", type=int, default=defaults.get("timed_runs", 10))
    parser.add_argument("--reference", default=None)
    parser.add_argument("--no-save", action="store_true")
    parser.add_argument("--report", action="store_true")

    # -- live-slm --
    live_slm_p = subparsers.add_parser("live-slm", help="Stream token-by-token SLM output")
    live_slm_p.add_argument("--model", required=True)
    live_slm_p.add_argument("--prompt", default=None)
    live_slm_p.add_argument("--prompt-file", default=None)
    live_slm_p.add_argument("--no-save", action="store_true")

    # -- live-asr --
    live_asr_p = subparsers.add_parser("live-asr", help="Stream chunk-by-chunk ASR transcription")
    live_asr_p.add_argument("--model", required=True)
    live_asr_p.add_argument("--audio", required=True)
    live_asr_p.add_argument("--chunk-ms", type=int, default=500)
    live_asr_p.add_argument("--no-save", action="store_true")

    args = parser.parse_args()

    if args.subcommand == "live-slm":
        _run_live_slm(args)
    elif args.subcommand == "live-asr":
        _run_live_asr(args)
    else:
        # batch mode — either via 'batch' subcommand or legacy root flags
        if args.subcommand is None and args.model is None:
            parser.print_help()
            sys.exit(1)
        _run_batch(args, defaults)


if __name__ == "__main__":
    main()