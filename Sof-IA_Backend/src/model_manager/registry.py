"""Write new model entries to config/models.yaml after a successful conversion."""

from pathlib import Path

import yaml

_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "models.yaml"


def add_pytorch_to_yaml(entry: dict) -> None:
    """Append a PyTorch variant entry to config/models.yaml.

    Key is ``<id>_pytorch`` (e.g. ``medgemma_4b_it_pytorch``).
    If the key already exists the file is left unchanged.
    """
    yaml_key = entry["id"].replace("-", "_").replace(".", "_") + "_pytorch"
    model_path = f"models/{entry['id']}-pytorch"

    pytorch_class = (
        "src.slm.generic_pytorch.GenericSLMPyTorch" if entry["type"] == "slm"
        else "src.asr.whisper_pytorch.WhisperPyTorch"
    )
    label = entry["label"].replace("OpenVINO", "PyTorch").replace("INT8", "FP32").replace("INT4", "FP32")
    if "PyTorch" not in label:
        label = label + " — PyTorch CPU"

    with open(_CONFIG_PATH, encoding="utf-8") as f:
        config = yaml.safe_load(f)

    if yaml_key in config.get("models", {}):
        return

    new_entry: dict = {
        "enabled": True,
        "type": entry["type"],
        "class": pytorch_class,
        "label": label,
        "model_path": model_path,
        "hub_id": entry["hub_id"],
    }

    if entry["type"] == "slm":
        new_entry["max_new_tokens"] = entry.get("max_new_tokens", 512)
        if entry.get("chat_format"):
            new_entry["chat_format"] = entry["chat_format"]

    config.setdefault("models", {})[yaml_key] = new_entry

    with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.dump(config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def add_model_to_yaml(entry: dict, compression: str) -> None:
    """Append a new model entry to config/models.yaml.

    If the key already exists the file is left unchanged.

    Args:
        entry:       A dict from CATALOGUE.
        compression: The compression format used ("int8" or "int4").
    """
    yaml_key = entry["id"].replace("-", "_").replace(".", "_")
    model_path = f"models/{entry['id']}"

    with open(_CONFIG_PATH, encoding="utf-8") as f:
        config = yaml.safe_load(f)

    if yaml_key in config.get("models", {}):
        return

    new_entry: dict = {
        "enabled": True,
        "type": entry["type"],
        "class": entry["model_class"],
        "label": entry["label"],
        "model_path": model_path,
        "hub_id": entry["hub_id"],
    }

    if entry["type"] == "slm":
        new_entry["max_new_tokens"] = entry.get("max_new_tokens", 512)
        if entry.get("chat_format"):
            new_entry["chat_format"] = entry["chat_format"]

    config.setdefault("models", {})[yaml_key] = new_entry

    with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.dump(config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)