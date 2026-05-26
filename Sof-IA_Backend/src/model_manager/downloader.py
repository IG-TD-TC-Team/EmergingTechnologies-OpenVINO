"""Download and convert a catalogue model to OpenVINO format.

The public function ``download_and_convert`` is called from a background task
in ``web/server.py``.  Progress is reported via a ``ProgressChannel`` so the
web UI can stream live updates to the browser over SSE.
"""

from __future__ import annotations

import logging
from pathlib import Path

from src.benchmark.resources import sdpa_no_vmap

logger = logging.getLogger(__name__)


_MODELS_ROOT = Path(__file__).resolve().parents[2] / "models"


def download_and_convert(entry: dict, compression: str, channel, hf_token: str | None = None) -> dict:
    """Download a model from HuggingFace Hub and convert it to OpenVINO.

    Args:
        entry:       A dict from CATALOGUE.
        compression: "int8" or "int4".
        channel:     A ProgressChannel (PrintProgressChannel or QueueProgressChannel).

    Returns:
        A plain dict with "model_path" and "size_mb" keys on success.

    Raises:
        ValueError:  If entry type or compression is unsupported.
        RuntimeError: If the conversion fails.
    """
    hub_id = entry["hub_id"]
    model_id = entry["id"]
    model_type = entry["type"]
    output_path = _MODELS_ROOT / model_id

    channel.send_progress(f"Starting download of '{hub_id}' ({compression.upper()})")
    output_path.mkdir(parents=True, exist_ok=True)

    if hf_token:
        _set_hf_token(hf_token, channel)

    try:
        if model_type == "asr":
            _convert_asr(hub_id, output_path, channel)
        elif model_type == "slm":
            _convert_slm(hub_id, output_path, compression, channel)
        else:
            raise ValueError(f"Unsupported model type: {model_type}")
    except Exception as exc:
        logger.exception("download_and_convert failed model_id=%s", model_id)
        raise RuntimeError(_friendly_error(exc, hub_id)) from exc

    size_mb = _dir_size_mb(output_path)
    channel.send_progress(f"Saved to models/{model_id} ({size_mb:.0f} MB)")
    return {"model_path": str(output_path), "size_mb": size_mb}


def download_pytorch(entry: dict, channel, hf_token: str | None = None) -> dict:
    """Download raw PyTorch weights from HuggingFace and save to disk.

    Saves to models/<id>-pytorch/ so it coexists with the OpenVINO variant.

    Returns:
        A plain dict with "model_path" and "size_mb" keys on success.
    """
    hub_id = entry["hub_id"]
    model_id = entry["id"]
    model_type = entry["type"]
    output_path = _MODELS_ROOT / f"{model_id}-pytorch"

    channel.send_progress(f"Starting download of '{hub_id}' (PyTorch weights)")
    output_path.mkdir(parents=True, exist_ok=True)

    if hf_token:
        _set_hf_token(hf_token, channel)

    try:
        if model_type == "slm":
            _download_pytorch_slm(hub_id, output_path, channel)
        elif model_type == "asr":
            _download_pytorch_asr(hub_id, output_path, channel)
        else:
            raise ValueError(f"Unsupported model type: {model_type}")
    except Exception as exc:
        logger.exception("download_pytorch failed model_id=%s", model_id)
        raise RuntimeError(_friendly_error(exc, hub_id)) from exc

    size_mb = _dir_size_mb(output_path)
    channel.send_progress(f"Saved to models/{model_id}-pytorch ({size_mb:.0f} MB)")
    return {"model_path": str(output_path), "size_mb": size_mb}


def _download_pytorch_slm(hub_id: str, output_path: Path, channel) -> None:
    from transformers import AutoModelForCausalLM, AutoTokenizer

    channel.send_progress(f"Downloading '{hub_id}' weights (this may take several minutes)...")
    model = AutoModelForCausalLM.from_pretrained(hub_id)
    channel.send_progress("Saving model weights...")
    model.save_pretrained(str(output_path))

    channel.send_progress("Saving tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(hub_id)
    tokenizer.save_pretrained(str(output_path))
    channel.send_progress("PyTorch download complete.")


def _download_pytorch_asr(hub_id: str, output_path: Path, channel) -> None:
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

    channel.send_progress(f"Downloading '{hub_id}' weights (this may take several minutes)...")
    model = AutoModelForSpeechSeq2Seq.from_pretrained(hub_id)
    channel.send_progress("Saving model weights...")
    model.save_pretrained(str(output_path))

    channel.send_progress("Saving processor/tokenizer...")
    processor = AutoProcessor.from_pretrained(hub_id)
    processor.save_pretrained(str(output_path))
    channel.send_progress("PyTorch download complete.")


def _set_hf_token(token: str, channel) -> None:
    import os
    os.environ["HF_TOKEN"] = token
    os.environ["HUGGING_FACE_HUB_TOKEN"] = token
    try:
        from huggingface_hub import login
        login(token=token, add_to_git_credential=False)
        channel.send_progress("HuggingFace token applied.")
    except Exception:
        channel.send_progress("HuggingFace token set via environment variable.")


def _convert_asr(hub_id: str, output_path: Path, channel) -> None:
    from optimum.intel.openvino import OVModelForSpeechSeq2Seq
    from transformers import AutoProcessor

    channel.send_progress(f"Downloading and converting ASR model from '{hub_id}'...")
    # Export as stateful (optimum-intel default).  Do NOT pass stateful=False:
    # stateless seq2seq exports are broken in OV 2026.x (Reshape shape mismatch
    # on the multi-token forced-prefix prefill step).  The detect_language()
    # attn-mask bug (the other OV 2026.x issue) is fixed by always passing
    # language= to generate() in WhisperOpenVINO.transcribe().
    model = OVModelForSpeechSeq2Seq.from_pretrained(hub_id, export=True, compile=False)
    channel.send_progress("Saving OpenVINO IR files...")
    model.save_pretrained(str(output_path))

    channel.send_progress("Saving processor/tokenizer...")
    processor = AutoProcessor.from_pretrained(hub_id)
    processor.save_pretrained(str(output_path))


def _patch_gemma3_multimodal_list() -> None:
    # optimum-intel 1.27.0 lists "gemma3" as multimodal, but Gemma3OnnxConfig
    # only implements the text-generation interface (no SUPPORTED_BEHAVIORS).
    # Removing it forces the standard text-generation export path, which is all
    # we need for voice/text inference (no vision encoder required).
    try:
        from optimum.exporters.openvino import convert as _ov
        mm = getattr(_ov, "MULTI_MODAL_TEXT_GENERATION_MODELS", None)
        if mm is not None and "gemma3" in mm:
            if isinstance(mm, (set, list)):
                mm.discard("gemma3") if isinstance(mm, set) else mm.remove("gemma3")
            else:
                _ov.MULTI_MODAL_TEXT_GENERATION_MODELS = type(mm)(m for m in mm if m != "gemma3")
    except Exception:
        pass


# Sentinel phrase emitted by optimum-intel when a model type has no registered
# OnnxConfig (e.g. Apertus, which is a custom Mistral-family architecture).
_UNSUPPORTED_ARCH_PHRASE = "custom or unsupported architecture"


def _convert_slm(hub_id: str, output_path: Path, compression: str, channel) -> None:
    _patch_gemma3_multimodal_list()
    if compression == "int4":
        _convert_slm_int4(hub_id, output_path, channel)
    else:
        _convert_slm_int8(hub_id, output_path, channel)


def _convert_slm_int8(hub_id: str, output_path: Path, channel) -> None:
    from optimum.exporters.openvino import main_export

    channel.send_progress(f"Downloading '{hub_id}' and exporting to OpenVINO INT8...")
    channel.send_progress("This may take 5-15 minutes depending on model size.")
    try:
        # Two-layer defence against the torch.vmap-in-jit.trace crash
        # (transformers >= 4.50 uses vmap in sdpa_mask_recent_torch).
        # Layer 1: _attn_implementation="eager" — primary fix, prevents
        #   create_causal_mask from ever selecting the vmap path.
        # Layer 2: sdpa_no_vmap() — defence-in-depth for models that
        #   override _attn_implementation at layer level.
        with sdpa_no_vmap():
            main_export(
                model_name_or_path=hub_id,
                output=str(output_path),
                task="text-generation-with-past",
                library_name="transformers",
                model_loading_kwargs={
                    "_attn_implementation": "eager",
                    "torch_dtype": "auto",
                },
            )
    except Exception as exc:
        if _UNSUPPORTED_ARCH_PHRASE in str(exc):
            channel.send_progress(
                f"'{hub_id}' uses a custom architecture not supported by the generic "
                "exporter — switching to multi-tier custom export strategy."
            )
            _convert_custom_arch(hub_id, output_path, channel)
            return
        raise
    channel.send_progress("INT8 export complete.")


def _convert_slm_int4(hub_id: str, output_path: Path, channel) -> None:
    from optimum.intel import OVModelForCausalLM

    channel.send_progress(f"Downloading '{hub_id}' and exporting to OpenVINO INT4...")
    channel.send_progress("This may take 10-30 minutes depending on model size.")

    try:
        from optimum.intel import OVWeightQuantizationConfig
        quant_config = OVWeightQuantizationConfig(bits=4, sym=True, ratio=1.0, group_size=-1)
    except ImportError:
        logger.warning("OVWeightQuantizationConfig not available — falling back to INT8")
        channel.send_progress("OVWeightQuantizationConfig unavailable — falling back to INT8")
        _convert_slm_int8(hub_id, output_path, channel)
        return

    try:
        # Patch sdpa_mask_recent_torch with a vmap-free broadcasting version
        # before export.  Same vmap incompatibility applies to INT4 path.
        with sdpa_no_vmap():
            model = OVModelForCausalLM.from_pretrained(
                hub_id,
                export=True,
                quantization_config=quant_config,
            )
    except Exception as exc:
        exc_str = str(exc)
        if "stoll argument out of range" in exc_str or "frontends/common" in exc_str.replace("\\", "/"):
            channel.send_progress(
                "INT4 export hit an OpenVINO integer-overflow bug for this architecture — "
                "falling back to INT8."
            )
            _convert_slm_int8(hub_id, output_path, channel)
            return
        if _UNSUPPORTED_ARCH_PHRASE in exc_str:
            channel.send_progress(
                f"'{hub_id}' uses a custom architecture not supported by the generic "
                "exporter — switching to multi-tier custom export strategy (INT4)."
            )
            _convert_custom_arch(hub_id, output_path, channel)
            return
        raise
    channel.send_progress("Saving OpenVINO INT4 IR files...")
    model.save_pretrained(str(output_path))

    from transformers import AutoTokenizer
    channel.send_progress("Saving tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(hub_id)
    tokenizer.save_pretrained(str(output_path))

    channel.send_progress("INT4 export complete.")


def _convert_custom_arch(hub_id: str, output_path: Path, channel) -> None:
    """Export a custom/unsupported architecture using ApertusOpenVINO's 3-tier strategy.

    When the generic optimum-intel exporter raises "custom or unsupported architecture",
    this function delegates to ApertusOpenVINO._export(), which tries:
      Tier 1 — optimum-intel + Mistral OnnxConfig + vmap patch (INT4 via NNCF)
      Tier 2 — FX-based KV-cache export (torch.export + ov.convert_model + NNCF INT4)
    All tiers use INT4 weight compression (same as the benchmark screen path).
    """
    # Import here to avoid circular dependency at module load time.
    from src.slm.apertus_openvino import ApertusOpenVINO

    exporter = ApertusOpenVINO(
        model_id=hub_id.replace("/", "_"),
        model_path=str(output_path),
        hub_id=hub_id,
        channel=channel,
    )
    exporter._export(output_path)
    channel.send_progress("Custom-architecture export complete.")


def _friendly_error(exc: Exception, hub_id: str) -> str:
    msg = str(exc)
    if "gated" in msg.lower() or "401" in msg or "restricted" in msg.lower():
        return (
            f"GATED_MODEL:{hub_id}\n"
            f"'{hub_id}' requires HuggingFace access:\n"
            "1. Accept model terms on huggingface.co\n"
            "2. Paste your HF token in the field above\n"
            "Then try again."
        )
    if "not found" in msg.lower() or "404" in msg:
        return f"Model '{hub_id}' not found on HuggingFace Hub. Check the hub_id in catalogue.py."
    if "out of memory" in msg.lower() or "oom" in msg.lower():
        return "Out of memory during conversion. Try INT8 instead of INT4, or close other applications."
    if "codec can't encode" in msg.lower() or "codec can't decode" in msg.lower():
        return (
            "Encoding error while writing model files (Windows latin-1 vs UTF-8 mismatch).\n"
            "Restart the server — the UTF-8 fix in server.py will apply on next start."
        )
    return f"Conversion failed: {exc}"


def _dir_size_mb(path: Path) -> float:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) / (1024 ** 2)