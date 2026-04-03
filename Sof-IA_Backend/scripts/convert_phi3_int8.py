"""Convert Phi-3 PyTorch model to OpenVINO INT8.

Exports the model using main_export directly to avoid temp-dir issues.
For models >1B params, INT8 weight compression is applied automatically.

Usage:
    python scripts/convert_phi3_int8.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from optimum.exporters.openvino import main_export

SRC = "models/phi3-mini-pytorch"
DST = "models/phi3-mini-4k-int8"

print(f"Source : {SRC}")
print(f"Output : {DST}")
Path(DST).mkdir(parents=True, exist_ok=True)

print("Exporting to OpenVINO IR with automatic INT8 weight compression...")
main_export(
    model_name_or_path=SRC,
    output=DST,
    task="text-generation-with-past",
    library_name="transformers",
)
print(f"Done — model saved to {DST}")
