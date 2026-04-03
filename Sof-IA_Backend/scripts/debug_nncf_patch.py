"""Diagnose why patch_nncf_compat() does not prevent the NNCFLogger TypeError.

Run from the repo root:
    python scripts/debug_nncf_patch.py

This script:
  1. Triggers the same import sequence as apertus_openvino.py
  2. Inspects the transformers.activations.logger *before* and *after* the patch
  3. Simulates the failing call to confirm the fix works (or find a new approach)
"""
import sys
import inspect
import types

print("=" * 70)
print("Step 1 — trigger NNCF by importing optimum.intel (same as module-load)")
print("=" * 70)

try:
    from optimum.intel import OVWeightQuantizationConfig, OVModelForCausalLM
    print("  optimum.intel imported OK")
except Exception as e:
    print(f"  import failed: {e}")

print()
print("=" * 70)
print("Step 2 — inspect transformers.activations.logger BEFORE patch")
print("=" * 70)

import transformers.activations as _act

_log = getattr(_act, "logger", None)
print(f"  logger object  : {_log!r}")
print(f"  type(logger)   : {type(_log)}")
print(f"  type.__mro__   : {[c.__name__ for c in type(_log).__mro__]}")

_wonce = getattr(_log, "warning_once", None)
print(f"  warning_once   : {_wonce!r}")
print(f"  in __dict__?   : {'warning_once' in _log.__dict__}")
print(f"  on direct class: {'warning_once' in type(_log).__dict__}")

# Walk MRO to find where warning_once is defined
for cls in type(_log).__mro__:
    if "warning_once" in cls.__dict__:
        fn = cls.__dict__["warning_once"]
        try:
            sig = inspect.signature(fn)
        except Exception as ex:
            sig = f"<signature error: {ex}>"
        print(f"  found on {cls.__name__}: {fn!r}  sig={sig}")
        break
else:
    print("  warning_once NOT found in any class in MRO")

if _wonce:
    try:
        sig = inspect.signature(_wonce)
        print(f"  effective sig  : {sig}")
        params = list(sig.parameters.values())
        has_var = any(p.kind == inspect.Parameter.VAR_POSITIONAL for p in params)
        print(f"  accepts *args? : {has_var}")
    except Exception as ex:
        print(f"  sig inspect err: {ex}")

print()
print("=" * 70)
print("Step 3 — simulate the failing call BEFORE patch")
print("=" * 70)

if _wonce:
    try:
        _log.warning_once("test %s", "value")
        print("  PASS — call succeeded (no patch needed?)")
    except TypeError as e:
        print(f"  FAIL (expected) — {e}")
    except Exception as e:
        print(f"  FAIL (unexpected) — {type(e).__name__}: {e}")

print()
print("=" * 70)
print("Step 4 — apply patch_nncf_compat()")
print("=" * 70)

sys.path.insert(0, ".")
from src.benchmark.resources import patch_nncf_compat
patch_nncf_compat()
print("  patch_nncf_compat() completed")

print()
print("=" * 70)
print("Step 5 — inspect transformers.activations.logger AFTER patch")
print("=" * 70)

_log2 = getattr(_act, "logger", None)
_wonce2 = getattr(_log2, "warning_once", None)
print(f"  same object?   : {_log is _log2}")
print(f"  warning_once   : {_wonce2!r}")
print(f"  in __dict__?   : {'warning_once' in _log2.__dict__}")
print(f"  changed?       : {_wonce is not _wonce2}")

print()
print("=" * 70)
print("Step 6 — simulate the failing call AFTER patch")
print("=" * 70)

if _wonce2:
    try:
        _log2.warning_once("test %s", "value")
        print("  PASS — call succeeded")
    except TypeError as e:
        print(f"  FAIL — {e}")
    except Exception as e:
        print(f"  FAIL — {type(e).__name__}: {e}")

print()
print("=" * 70)
print("Step 7 — simulate actual Apertus activation call")
print("=" * 70)
print("  (importing transformers xielu activation path)")

try:
    from transformers.activations import ACT2FN
    print(f"  ACT2FN keys with 'xiel': {[k for k in ACT2FN if 'xiel' in k.lower()]}")
except Exception as e:
    print(f"  ACT2FN import error: {e}")

print()
print("Done.")
