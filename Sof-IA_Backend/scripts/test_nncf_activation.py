"""Verify that patch_nncf_compat() survives the actual Apertus activation init.

Run from repo root:
    python scripts/test_nncf_activation.py
"""
import sys
sys.path.insert(0, ".")

# Trigger the same import chain as apertus_openvino.py
from optimum.intel import OVWeightQuantizationConfig  # noqa: causes nncf patching

from src.benchmark.resources import patch_nncf_compat
patch_nncf_compat()

print("Patch applied. Simulating ACT2FN['xielu'] construction...")

try:
    from transformers.activations import ACT2FN
    act = ACT2FN["xielu"]  # this triggers logger.warning_once(fmt, arg)
    print(f"PASS — ACT2FN['xielu'] created: {type(act).__name__}")
except TypeError as e:
    print(f"FAIL — TypeError: {e}")
except Exception as e:
    print(f"INFO — {type(e).__name__}: {e}")
