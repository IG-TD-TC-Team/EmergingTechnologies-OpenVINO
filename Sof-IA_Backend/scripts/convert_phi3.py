"""Convert Phi-3-mini-4k-instruct to OpenVINO IR with INT8 weight compression.

Why main_export instead of OVModelForCausalLM.from_pretrained?
---------------------------------------------------------------
OVModelForCausalLM._export() always passes ov_config=None (or an OVConfig
with no quantization_config) to main_export.  When ov_config.quantization_config
is None, main_export calls _apply_model_size_based_quantization(), which reads
the freshly-written IR back with core.read_model() and crashes on
OpenVINO ≥ 2025.x with:

    RuntimeError: stoll argument out of range

Passing an explicit OVConfig(quantization_config=OVWeightQuantizationConfig(...))
directly to main_export sets ov_config.quantization_config to a truthy,
non-GPTOSSQuantizationConfig value.  main_export then skips
_apply_model_size_based_quantization() entirely and applies NNCF INT8
compression inline during export — no post-export read-back, no crash.

Usage:
    python scripts/convert_phi3.py
"""
from pathlib import Path

from optimum.exporters.openvino import main_export
from optimum.intel.openvino.configuration import OVConfig, OVWeightQuantizationConfig
from transformers import AutoTokenizer

MODEL_ID = "microsoft/Phi-3-mini-4k-instruct"
OUTPUT_DIR = "models/phi3-mini-ov"

print(f"Source : {MODEL_ID}")
print(f"Output : {OUTPUT_DIR}")
Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)

print("Saving tokenizer...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
tokenizer.save_pretrained(OUTPUT_DIR)

print("Exporting to OpenVINO IR with NNCF INT8 weight compression...")
# Explicit quantization_config → main_export routes through NNCF (not
# _apply_model_size_based_quantization) — works on OpenVINO 2024.x–2026.x.
ov_config = OVConfig(quantization_config=OVWeightQuantizationConfig(bits=8, sym=False))
main_export(
    model_name_or_path=MODEL_ID,
    output=OUTPUT_DIR,
    task="text-generation-with-past",
    library_name="transformers",
    ov_config=ov_config,
)

print(f"Done — model saved to {OUTPUT_DIR}")