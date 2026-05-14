"""Disk status detection for catalogue models.

Checks whether a catalogue model's local directory exists and what format
it contains (OpenVINO IR, PyTorch safetensors, or nothing).
"""

from pathlib import Path

_MODELS_ROOT = Path(__file__).resolve().parents[2] / "models"


def get_pytorch_status(entry: dict) -> str:
    """Return whether the PyTorch weights for a catalogue entry are on disk.

    Returns:
        "downloaded" — safetensors weights present in models/<id>-pytorch/.
        "available"  — not downloaded.
    """
    pytorch_dir = _MODELS_ROOT / f"{entry['id']}-pytorch"
    if (pytorch_dir / "config.json").exists() and list(pytorch_dir.glob("*.safetensors")):
        return "downloaded"
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