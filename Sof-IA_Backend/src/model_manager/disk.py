"""Disk status detection for catalogue models.

Checks whether a catalogue model's local directory exists and what format
it contains (OpenVINO IR, PyTorch safetensors, or nothing).
"""

from pathlib import Path

_MODELS_ROOT = Path(__file__).resolve().parents[2] / "models"


def get_pytorch_status(entry: dict) -> str:
    """Return whether the PyTorch weights for a catalogue entry are on disk.

    Returns:
        "downloaded" — safetensors weights present in models/<id>-pytorch/
                       OR in any models.yaml-registered path for a pytorch
                       variant that shares the same hub_id.
        "available"  — not downloaded.
    """
    pytorch_dir = _MODELS_ROOT / f"{entry['id']}-pytorch"
    if (pytorch_dir / "config.json").exists() and list(pytorch_dir.glob("*.safetensors")):
        return "downloaded"

    # Fall back: check any models.yaml entry whose hub_id matches and whose
    # key contains "pytorch".  This covers pre-existing entries like
    # "phi3_pytorch" → models/phi3-mini-pytorch that predate the catalogue's
    # {entry-id}-pytorch naming convention.
    hub_id = entry.get("hub_id", "")
    if hub_id:
        try:
            import yaml
            cfg_path = _MODELS_ROOT.parent / "config" / "models.yaml"
            with open(cfg_path, encoding="utf-8") as f:
                models_cfg = yaml.safe_load(f).get("models", {})
            for key, cfg in models_cfg.items():
                if (
                    "pytorch" in key
                    and cfg.get("hub_id") == hub_id
                    and cfg.get("type") == entry.get("type")
                ):
                    mp = cfg.get("model_path", "")
                    if mp:
                        alt_dir = _MODELS_ROOT.parent / mp
                        if (alt_dir / "config.json").exists() and list(alt_dir.glob("*.safetensors")):
                            return "downloaded"
        except Exception:
            pass

    return "available"


def get_model_status(entry: dict) -> str:
    """Return the local disk status for a catalogue entry.

    Args:
        entry: A dict from CATALOGUE with at least an "id" key.

    Returns:
        "downloaded_ov"      — OpenVINO IR files present (openvino_model.xml).
        "downloaded_pytorch" — PyTorch safetensors present but no OV IR.
        "available"          — Nothing on disk.
    """
    model_dir = _MODELS_ROOT / entry["id"]

    # SLM: openvino_model.xml  |  ASR (Whisper): openvino_encoder_model.xml
    ov_markers = ["openvino_model.xml", "openvino_encoder_model.xml"]
    if any((model_dir / m).exists() for m in ov_markers):
        return "downloaded_ov"

    if (model_dir / "config.json").exists() and list(model_dir.glob("*.safetensors")):
        return "downloaded_pytorch"

    return "available"