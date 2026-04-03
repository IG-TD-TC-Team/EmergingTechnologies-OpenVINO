"""Verify the 0-D parameter reshape fix allows ov.convert_model to succeed.

Reproduces the xIELU beta = torch.tensor(0.5) case in a tiny model.
Run from repo root:  python scripts/test_ov_scalar_param.py
"""
import sys
sys.path.insert(0, ".")

import torch
import torch.nn as nn
import openvino as ov

class ScalarParamModel(nn.Module):
    """Mimics xIELU: a learnable 0-D scalar used in the forward pass."""
    def __init__(self):
        super().__init__()
        self.beta = nn.Parameter(torch.tensor(0.5))  # 0-D, same as xIELU

    def forward(self, x):
        return x * (1.0 + self.beta * x).sigmoid()

model = ScalarParamModel().eval()
x = torch.randn(1, 8, 64)

print(f"beta.shape before reshape: {model.beta.shape}")

print("\n-- Method A: torch.export without reshape (should fail with OV) --")
try:
    exported = torch.export.export(model, args=(x,), strict=False)
    ov1 = ov.convert_model(exported)
    print("  PASS (no reshape needed)")
except Exception as e:
    print(f"  FAIL as expected: {type(e).__name__}: {str(e)[:80]}")

print("\n-- Method B: reshape 0-D params to (1,) then torch.export --")
for module in model.modules():
    for pname, param in list(module._parameters.items()):
        if param is not None and param.dim() == 0:
            module._parameters[pname] = nn.Parameter(
                param.data.reshape(1), requires_grad=param.requires_grad
            )

print(f"  beta.shape after reshape: {model.beta.shape}")
try:
    exported = torch.export.export(model, args=(x,), strict=False)
    ov2 = ov.convert_model(exported)
    compiled = ov.compile_model(ov2)
    out = list(compiled({"x": x.numpy()}).values())[0]
    print(f"  inference OK — output shape: {out.shape}")
    print("  PASS")
except Exception as e:
    import traceback
    print(f"  FAIL: {type(e).__name__}: {str(e)[:120]}")
    traceback.print_exc()
