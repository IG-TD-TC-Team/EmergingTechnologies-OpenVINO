"""Apertus 8B OpenVINO compatibility test.

Tests whether swiss-ai/Apertus-8B-Instruct-2509 can be:
  1. Exported to OpenVINO IR (INT4, CPU)
  2. Run with OVModelForCausalLM
  3. Compared against Phi-3 Mini on the same French clinical prompt

Usage:
    python scripts/test_apertus_compatibility.py [--skip-export] [--skip-phi3]

Env vars:
    HF_TOKEN  — HuggingFace token (required for gated models)

Output:
    results/apertus_compat_<timestamp>.json  — machine-readable report
    Console                                  — human-readable summary
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
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
log = logging.getLogger("apertus_compat")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

APERTUS_HUB_ID = "swiss-ai/Apertus-8B-Instruct-2509"
PHI3_HUB_ID = "microsoft/Phi-3-mini-4k-instruct"

APERTUS_OV_PATH = Path("apertus-8b-ov")
PHI3_OV_PATH = Path("models/phi3-mini-ov")

FRENCH_PROMPT = (
    "Résume en une phrase: le patient présente une douleur thoracique."
)

MAX_NEW_TOKENS = 128

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _check_env() -> dict:
    """Verify critical packages are importable and log versions."""
    report: dict = {}
    packages = [
        ("transformers", "transformers"),
        ("optimum", "optimum"),
        ("optimum.intel", "optimum-intel"),
        ("torch", "torch"),
        ("openvino", "openvino"),
    ]
    for module, label in packages:
        try:
            mod = __import__(module)
            version = getattr(mod, "__version__", "unknown")
            log.info("  %-20s %s", label, version)
            report[label] = version
        except ImportError as exc:
            log.error("  %-20s MISSING (%s)", label, exc)
            report[label] = f"MISSING: {exc}"
    return report


def _disk_size_mb(path: Path) -> float:
    """Return total size of all files under *path* in MB."""
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return round(total / (1024 ** 2), 1)


def _export_apertus(output_path: Path) -> tuple[bool, str]:
    """Run optimum-cli export for Apertus 8B.

    Returns (success, message).
    """
    if output_path.exists() and any(output_path.iterdir()):
        log.info("Apertus OV model already at %s — skipping export", output_path)
        return True, "already_exported"

    log.info("Starting optimum-cli export for %s …", APERTUS_HUB_ID)
    log.info("Output directory: %s", output_path)

    cmd = [
        sys.executable, "-m", "optimum.exporters.openvino",
        "--model", APERTUS_HUB_ID,
        "--weight-format", "int4",
        "--sym",
        "--ratio", "1.0",
        "--group-size", "-1",
        str(output_path),
    ]

    # Fallback: try optimum-cli directly
    cli_cmd = [
        "optimum-cli", "export", "openvino",
        "--model", APERTUS_HUB_ID,
        "--weight-format", "int4",
        "--sym",
        "--ratio", "1.0",
        "--group-size", "-1",
        str(output_path),
    ]

    env = os.environ.copy()
    hf_token = env.get("HF_TOKEN", "")
    if hf_token:
        log.info("HF_TOKEN found — authenticated download enabled")
    else:
        log.warning("HF_TOKEN not set — may fail for gated models")

    # Try optimum-cli first, fall back to python -m
    for attempt_cmd in (cli_cmd, cmd):
        log.info("Running: %s", " ".join(attempt_cmd))
        t0 = time.perf_counter()
        try:
            result = subprocess.run(
                attempt_cmd,
                env=env,
                capture_output=False,  # stream output to console
                timeout=3600,          # 1 hour max
            )
            elapsed = time.perf_counter() - t0
            if result.returncode == 0:
                log.info("Export succeeded in %.0fs", elapsed)
                return True, f"export_ok ({elapsed:.0f}s)"
            else:
                log.warning("Command exited with code %d", result.returncode)
        except FileNotFoundError:
            log.debug("Command not found, trying next: %s", attempt_cmd[0])
            continue
        except subprocess.TimeoutExpired:
            return False, "export_timeout (>1h)"
        except Exception as exc:
            return False, f"export_error: {exc}"

    return False, "export_failed: both cli and module invocations failed"


def _run_inference(
    model_path: Path,
    hub_id: str,
    prompt: str,
    max_new_tokens: int,
    label: str,
) -> dict:
    """Load OVModelForCausalLM from *model_path* and run one inference pass.

    Returns a result dict with keys: success, ttft_s, tokens_per_sec,
    n_tokens, output, error, model_size_mb.
    """
    result: dict = {
        "label": label,
        "model_path": str(model_path),
        "hub_id": hub_id,
        "prompt": prompt,
        "success": False,
        "ttft_s": None,
        "tokens_per_sec": None,
        "n_tokens": None,
        "output": None,
        "error": None,
        "model_size_mb": None,
    }

    try:
        from transformers import AutoTokenizer, TextIteratorStreamer
        from optimum.intel import OVModelForCausalLM
        import threading
    except ImportError as exc:
        result["error"] = f"import_error: {exc}"
        return result

    # ---- Model size on disk ------------------------------------------------
    if model_path.exists():
        result["model_size_mb"] = _disk_size_mb(model_path)

    # ---- Load tokenizer ----------------------------------------------------
    tokenizer_source = str(model_path) if model_path.exists() else hub_id
    log.info("[%s] Loading tokenizer from %s …", label, tokenizer_source)
    t_start = time.perf_counter()
    try:
        tokenizer = AutoTokenizer.from_pretrained(tokenizer_source)
    except Exception as exc:
        result["error"] = f"tokenizer_load_error: {exc}"
        log.error("[%s] Tokenizer load failed: %s", label, exc)
        return result

    # ---- Load model --------------------------------------------------------
    log.info("[%s] Loading OVModelForCausalLM …", label)
    try:
        if model_path.exists():
            model = OVModelForCausalLM.from_pretrained(str(model_path))
        else:
            # export on the fly (fallback, slow)
            log.warning("[%s] OV model not found — exporting on the fly from %s", label, hub_id)
            model = OVModelForCausalLM.from_pretrained(hub_id, export=True)
            model.save_pretrained(str(model_path))
            tokenizer.save_pretrained(str(model_path))
    except Exception as exc:
        result["error"] = f"model_load_error: {exc}"
        log.error("[%s] Model load failed: %s", label, exc)
        return result

    load_s = time.perf_counter() - t_start
    log.info("[%s] Load complete in %.1fs", label, load_s)

    # ---- Tokenize ----------------------------------------------------------
    inputs = tokenizer(prompt, return_tensors="pt")
    n_input_tokens: int = inputs["input_ids"].shape[-1]
    log.info("[%s] Prompt tokens: %d", label, n_input_tokens)

    # ---- Streaming inference (TTFT + tokens/sec) ---------------------------
    log.info("[%s] Running streaming inference …", label)
    streamer = TextIteratorStreamer(
        tokenizer, skip_prompt=True, skip_special_tokens=True
    )
    gen_kwargs = {
        **inputs,
        "max_new_tokens": max_new_tokens,
        "do_sample": False,
        "streamer": streamer,
    }
    thread = threading.Thread(target=model.generate, kwargs=gen_kwargs)

    tokens: list[str] = []
    ttft_s: float | None = None

    t_gen_start = time.perf_counter()
    thread.start()

    try:
        for token in streamer:
            tokens.append(token)
            if ttft_s is None and token.strip():
                ttft_s = time.perf_counter() - t_gen_start
    except Exception as exc:
        result["error"] = f"generation_error: {exc}"
        log.error("[%s] Generation failed: %s", label, exc)
        thread.join()
        return result

    thread.join()
    elapsed_s = time.perf_counter() - t_gen_start

    n_tokens = len(tokens)
    tokens_per_sec = round(n_tokens / elapsed_s, 2) if elapsed_s > 0 else None
    full_text = "".join(tokens)

    result.update(
        success=True,
        ttft_s=round(ttft_s, 3) if ttft_s is not None else None,
        tokens_per_sec=tokens_per_sec,
        n_tokens=n_tokens,
        output=full_text,
        load_s=round(load_s, 1),
        elapsed_s=round(elapsed_s, 2),
    )
    log.info(
        "[%s] Done — %d tokens in %.2fs (%.1f tok/s), TTFT=%.3fs",
        label, n_tokens, elapsed_s, tokens_per_sec or 0, ttft_s or 0,
    )
    log.info("[%s] Output: %s", label, full_text[:200])

    # ---- Cleanup -----------------------------------------------------------
    del model
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Apertus 8B OpenVINO compatibility test")
    parser.add_argument(
        "--skip-export", action="store_true",
        help="Skip export step (assume model already at apertus-8b-ov/)"
    )
    parser.add_argument(
        "--skip-phi3", action="store_true",
        help="Skip Phi-3 Mini comparison"
    )
    parser.add_argument(
        "--apertus-path", default=str(APERTUS_OV_PATH),
        help=f"Local path for Apertus OV model (default: {APERTUS_OV_PATH})"
    )
    parser.add_argument(
        "--phi3-path", default=str(PHI3_OV_PATH),
        help=f"Local path for Phi-3 OV model (default: {PHI3_OV_PATH})"
    )
    args = parser.parse_args()

    apertus_path = Path(args.apertus_path)
    phi3_path = Path(args.phi3_path)

    report: dict = {
        "timestamp": datetime.now().isoformat(),
        "prompt": FRENCH_PROMPT,
        "max_new_tokens": MAX_NEW_TOKENS,
        "env": {},
        "export": {},
        "apertus": {},
        "phi3": {},
    }

    # ---- Environment check -------------------------------------------------
    log.info("=" * 60)
    log.info("Environment check")
    log.info("=" * 60)
    report["env"] = _check_env()

    # ---- Export Apertus ----------------------------------------------------
    if not args.skip_export:
        log.info("=" * 60)
        log.info("Exporting Apertus 8B to OpenVINO INT4")
        log.info("=" * 60)
        export_ok, export_msg = _export_apertus(apertus_path)
        report["export"] = {"success": export_ok, "message": export_msg}
        if not export_ok:
            log.error("Export failed: %s", export_msg)
            log.error("Inference test will attempt OVModelForCausalLM on-the-fly export as fallback.")
    else:
        log.info("Skipping export (--skip-export)")
        export_ok = apertus_path.exists() and any(apertus_path.iterdir())
        report["export"] = {
            "success": export_ok,
            "message": "skipped" if not export_ok else "already_exported",
        }

    # ---- Apertus inference -------------------------------------------------
    log.info("=" * 60)
    log.info("Apertus 8B — inference test")
    log.info("=" * 60)
    report["apertus"] = _run_inference(
        model_path=apertus_path,
        hub_id=APERTUS_HUB_ID,
        prompt=FRENCH_PROMPT,
        max_new_tokens=MAX_NEW_TOKENS,
        label="Apertus-8B",
    )

    # ---- Phi-3 comparison --------------------------------------------------
    if not args.skip_phi3:
        log.info("=" * 60)
        log.info("Phi-3 Mini — comparison inference")
        log.info("=" * 60)
        report["phi3"] = _run_inference(
            model_path=phi3_path,
            hub_id=PHI3_HUB_ID,
            prompt=FRENCH_PROMPT,
            max_new_tokens=MAX_NEW_TOKENS,
            label="Phi-3-Mini",
        )
    else:
        log.info("Skipping Phi-3 comparison (--skip-phi3)")
        report["phi3"] = {"skipped": True}

    # ---- Comparison summary ------------------------------------------------
    log.info("=" * 60)
    log.info("RESULTS SUMMARY")
    log.info("=" * 60)

    def _fmt_row(r: dict) -> str:
        if r.get("skipped"):
            return "  skipped"
        if not r.get("success"):
            return f"  FAILED — {r.get('error', 'unknown error')}"
        return (
            f"  tokens/sec : {r.get('tokens_per_sec')} tok/s\n"
            f"  TTFT       : {r.get('ttft_s')} s\n"
            f"  n_tokens   : {r.get('n_tokens')}\n"
            f"  model_size : {r.get('model_size_mb')} MB\n"
            f"  output     : {str(r.get('output', ''))[:150]}"
        )

    log.info("Apertus 8B INT4:\n%s", _fmt_row(report["apertus"]))
    if not args.skip_phi3:
        log.info("Phi-3 Mini:\n%s", _fmt_row(report["phi3"]))

    # ---- Save report -------------------------------------------------------
    results_dir = Path("results")
    results_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = results_dir / f"apertus_compat_{timestamp}.json"
    out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Report saved to %s", out_path)


if __name__ == "__main__":
    main()