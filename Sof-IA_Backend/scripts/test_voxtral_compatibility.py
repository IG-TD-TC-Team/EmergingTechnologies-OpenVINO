"""Voxtral Mini 4B compatibility test.

Tests whether mistralai/Voxtral-Mini-4B-Realtime-2602 can be:
  1. Loaded with VoxtralForConditionalGeneration (PyTorch BF16 baseline)
  2. Exported to OpenVINO (encoder INT8 + LM INT4) and run end-to-end
  3. Compared on the same audio + prompt

Usage:
    python scripts/test_voxtral_compatibility.py \\
        --audio data/benchmark/asr_audio.wav \\
        --prompt "Please transcribe this audio." \\
        [--skip-pytorch] [--skip-openvino] [--max-tokens 128]

Env vars:
    HF_TOKEN  — HuggingFace token (required if model is gated)

Output:
    results/voxtral_compat_<timestamp>.json  — machine-readable report
    Console                                  — human-readable summary
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("voxtral_compat")

# ---------------------------------------------------------------------------
# Project root on sys.path so src.* imports work
# ---------------------------------------------------------------------------

_ROOT = Path(__file__).parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VOXTRAL_HUB_ID  = "mistralai/Voxtral-Mini-4B-Realtime-2602"
PYTORCH_PATH    = Path("models/voxtral-mini-4b-pytorch")
OV_PATH         = Path("models/voxtral-mini-4b-int4")
DEFAULT_PROMPT  = "Please transcribe this audio."
MAX_NEW_TOKENS  = 256

# ---------------------------------------------------------------------------
# Environment check
# ---------------------------------------------------------------------------


def _check_env() -> dict:
    packages = [
        ("transformers", "transformers"),
        ("torch", "torch"),
        ("openvino", "openvino"),
        ("optimum", "optimum"),
        ("optimum.intel", "optimum-intel"),
        ("soundfile", "soundfile"),
        ("librosa", "librosa"),
        ("nncf", "nncf"),
    ]
    report: dict = {}
    for module, label in packages:
        try:
            mod = __import__(module)
            version = getattr(mod, "__version__", "unknown")
            log.info("  %-20s %s", label, version)
            report[label] = version
        except ImportError as exc:
            log.warning("  %-20s MISSING (%s)", label, exc)
            report[label] = f"MISSING: {exc}"

    # Check VoxtralForConditionalGeneration availability
    try:
        from transformers import VoxtralForConditionalGeneration  # noqa: F401
        log.info("  %-20s available", "VoxtralForConditionalGeneration")
        report["VoxtralForConditionalGeneration"] = "available"
    except ImportError as exc:
        log.warning("  %-20s MISSING (%s)", "VoxtralForConditionalGeneration", exc)
        report["VoxtralForConditionalGeneration"] = f"MISSING: {exc}"

    return report


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _disk_size_mb(path: Path) -> float:
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return round(total / (1024 ** 2), 1)


def _load_audio(audio_path: str) -> tuple:
    """Load audio as float32 mono 16 kHz. Returns (audio_array, sample_rate)."""
    import soundfile as sf
    import librosa

    audio, sr = sf.read(audio_path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != 16000:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
        sr = 16000
    return audio, sr


# ---------------------------------------------------------------------------
# PyTorch inference
# ---------------------------------------------------------------------------


def _run_pytorch(
    audio_path: str,
    prompt: str,
    max_new_tokens: int,
) -> dict:
    result: dict = {
        "backend": "pytorch_bf16",
        "success": False,
        "load_s": None,
        "inference_s": None,
        "n_tokens": None,
        "ms_per_token": None,
        "output": None,
        "error": None,
    }

    try:
        import torch
        from src.slm.voxtral_pytorch import VoxtralPyTorch
    except ImportError as exc:
        result["error"] = f"import_error: {exc}"
        return result

    t_load = time.perf_counter()
    try:
        model = VoxtralPyTorch(
            model_id="voxtral_pytorch",
            model_path=str(PYTORCH_PATH),
            max_new_tokens=max_new_tokens,
            hub_id=VOXTRAL_HUB_ID,
        )
        model.load()
    except Exception as exc:
        result["error"] = f"load_error: {exc}"
        log.error("PyTorch load failed: %s", exc, exc_info=True)
        return result

    result["load_s"] = round(time.perf_counter() - t_load, 1)
    log.info("[pytorch] Load complete in %.1fs", result["load_s"])

    t_inf = time.perf_counter()
    try:
        text, n_tokens = model.run(audio_path, prompt)
    except Exception as exc:
        result["error"] = f"inference_error: {exc}"
        log.error("PyTorch inference failed: %s", exc, exc_info=True)
        model.unload()
        return result

    inference_s = time.perf_counter() - t_inf
    result.update(
        success=True,
        inference_s=round(inference_s, 2),
        n_tokens=n_tokens,
        ms_per_token=round(inference_s * 1000 / max(n_tokens, 1), 1),
        output=text,
    )
    log.info("[pytorch] %d tokens in %.2fs (%.1f ms/tok)", n_tokens, inference_s, result["ms_per_token"])
    log.info("[pytorch] Output: %s", text[:300])

    model.unload()
    return result


# ---------------------------------------------------------------------------
# OpenVINO inference
# ---------------------------------------------------------------------------


def _run_openvino(
    audio_path: str,
    prompt: str,
    max_new_tokens: int,
) -> dict:
    result: dict = {
        "backend": "openvino_int4",
        "success": False,
        "load_s": None,
        "export_s": None,
        "inference_s": None,
        "n_tokens": None,
        "ms_per_token": None,
        "model_size_mb": None,
        "output": None,
        "error": None,
    }

    try:
        from src.slm.voxtral_openvino import VoxtralOpenVINO
    except ImportError as exc:
        result["error"] = f"import_error: {exc}"
        return result

    was_exported = (OV_PATH / "encoder_projector.xml").exists()
    t_load = time.perf_counter()
    try:
        model = VoxtralOpenVINO(
            model_id="voxtral_openvino",
            model_path=str(OV_PATH),
            max_new_tokens=max_new_tokens,
            hub_id=VOXTRAL_HUB_ID,
        )
        model.load()
    except Exception as exc:
        result["error"] = f"load_error: {exc}"
        log.error("OpenVINO load failed: %s", exc, exc_info=True)
        return result

    total_s = time.perf_counter() - t_load
    if not was_exported:
        result["export_s"] = round(total_s, 1)
        log.info("[openvino] Export + load complete in %.1fs", total_s)
    else:
        result["load_s"] = round(total_s, 1)
        log.info("[openvino] Load complete in %.1fs", total_s)

    if OV_PATH.exists():
        result["model_size_mb"] = _disk_size_mb(OV_PATH)
        log.info("[openvino] Model on disk: %.1f MB", result["model_size_mb"])

    t_inf = time.perf_counter()
    try:
        text, n_tokens = model.run(audio_path, prompt)
    except Exception as exc:
        result["error"] = f"inference_error: {exc}"
        log.error("OpenVINO inference failed: %s", exc, exc_info=True)
        model.unload()
        return result

    inference_s = time.perf_counter() - t_inf
    result.update(
        success=True,
        inference_s=round(inference_s, 2),
        n_tokens=n_tokens,
        ms_per_token=round(inference_s * 1000 / max(n_tokens, 1), 1),
        output=text,
    )
    log.info("[openvino] %d tokens in %.2fs (%.1f ms/tok)", n_tokens, inference_s, result["ms_per_token"])
    log.info("[openvino] Output: %s", text[:300])

    model.unload()
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Voxtral Mini 4B compatibility test")
    parser.add_argument(
        "--audio", required=True,
        help="Path to the audio file to process (WAV/FLAC/MP3, mono or stereo)",
    )
    parser.add_argument(
        "--prompt", default=DEFAULT_PROMPT,
        help=f"Text instruction appended after audio tokens (default: '{DEFAULT_PROMPT}')",
    )
    parser.add_argument(
        "--max-tokens", type=int, default=MAX_NEW_TOKENS,
        help=f"Maximum new tokens to generate (default: {MAX_NEW_TOKENS})",
    )
    parser.add_argument("--skip-pytorch",  action="store_true", help="Skip PyTorch backend test")
    parser.add_argument("--skip-openvino", action="store_true", help="Skip OpenVINO backend test")
    args = parser.parse_args()

    audio_path = Path(args.audio)
    if not audio_path.exists():
        log.error("Audio file not found: %s", audio_path)
        sys.exit(1)

    report: dict = {
        "timestamp": datetime.now().isoformat(),
        "audio": str(audio_path),
        "prompt": args.prompt,
        "max_new_tokens": args.max_tokens,
        "env": {},
        "pytorch": {},
        "openvino": {},
    }

    # ---- Environment check -------------------------------------------------
    log.info("=" * 60)
    log.info("Environment check")
    log.info("=" * 60)
    report["env"] = _check_env()

    if report["env"].get("VoxtralForConditionalGeneration", "").startswith("MISSING"):
        log.error(
            "VoxtralForConditionalGeneration not available — "
            "upgrade transformers: pip install -U transformers"
        )
        # Don't abort: OpenVINO path loads it lazily inside _export only

    # ---- PyTorch -----------------------------------------------------------
    if not args.skip_pytorch:
        log.info("=" * 60)
        log.info("Voxtral Mini 4B — PyTorch BF16 baseline")
        log.info("=" * 60)
        report["pytorch"] = _run_pytorch(str(audio_path), args.prompt, args.max_tokens)
    else:
        log.info("Skipping PyTorch backend (--skip-pytorch)")
        report["pytorch"] = {"skipped": True}

    # ---- OpenVINO ----------------------------------------------------------
    if not args.skip_openvino:
        log.info("=" * 60)
        log.info("Voxtral Mini 4B — OpenVINO INT4")
        log.info("=" * 60)
        report["openvino"] = _run_openvino(str(audio_path), args.prompt, args.max_tokens)
    else:
        log.info("Skipping OpenVINO backend (--skip-openvino)")
        report["openvino"] = {"skipped": True}

    # ---- Summary -----------------------------------------------------------
    log.info("=" * 60)
    log.info("RESULTS SUMMARY")
    log.info("=" * 60)

    def _fmt(r: dict) -> str:
        if r.get("skipped"):
            return "  skipped"
        if not r.get("success"):
            return f"  FAILED — {r.get('error', 'unknown error')}"
        lines = [
            f"  ms/token   : {r.get('ms_per_token')} ms",
            f"  n_tokens   : {r.get('n_tokens')}",
            f"  inference_s: {r.get('inference_s')} s",
        ]
        if r.get("model_size_mb"):
            lines.append(f"  model_size : {r.get('model_size_mb')} MB")
        lines.append(f"  output     : {str(r.get('output', ''))[:200]}")
        return "\n".join(lines)

    log.info("PyTorch BF16:\n%s", _fmt(report["pytorch"]))
    log.info("OpenVINO INT4:\n%s", _fmt(report["openvino"]))

    pt  = report["pytorch"]
    ov  = report["openvino"]
    if pt.get("success") and ov.get("success"):
        speedup = round(pt["ms_per_token"] / ov["ms_per_token"], 2)
        log.info("Speedup (PyTorch / OV): %.2fx", speedup)

    # ---- Save report -------------------------------------------------------
    results_dir = Path("results")
    results_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = results_dir / f"voxtral_compat_{timestamp}.json"
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Report saved to %s", out_path)


if __name__ == "__main__":
    main()
