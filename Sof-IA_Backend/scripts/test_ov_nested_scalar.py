"""Verify the reshape fix resolves the 0-D scalar param OV export failure.
Run from repo root:  python scripts/test_ov_nested_scalar.py
"""
import sys
sys.path.insert(0, ".")

import torch
import torch.nn as nn
import openvino as ov


class ScalarBetaAct(nn.Module):
    def __init__(self):
        super().__init__()
        self.beta = nn.Parameter(torch.tensor(0.5))  # 0-D scalar, same as xIELU

    def forward(self, x):
        return x * (1.0 + self.beta * x).sigmoid()


class MLP(nn.Module):
    def __init__(self, d):
        super().__init__()
        self.fc = nn.Linear(d, d)
        self.act = ScalarBetaAct()

    def forward(self, x):
        return self.act(self.fc(x))


class DecoderLayer(nn.Module):
    def __init__(self, d):
        super().__init__()
        self.mlp = MLP(d)

    def forward(self, x):
        return self.mlp(x)


class NestedScalarModel(nn.Module):
    """Nested 0-D scalar params inside multiple decoder layers — mirrors Apertus MLP."""
    def __init__(self, d=64, n_layers=2):
        super().__init__()
        self.layers = nn.ModuleList([DecoderLayer(d) for _ in range(n_layers)])

    def forward(self, input_ids: torch.Tensor):
        x = input_ids.float().unsqueeze(-1).expand(-1, -1, 64).clone()
        for layer in self.layers:
            x = layer(x)
        return x.mean(dim=-1)


model = NestedScalarModel().eval()
input_ids = torch.zeros(1, 8, dtype=torch.long)
n_scalar = sum(1 for p in model.parameters() if p.dim() == 0)
print(f"Scalar (0-D) params before fix: {n_scalar}")

print("\n-- Without reshape --")
try:
    exp = torch.export.export(model, args=(input_ids,), strict=False)
    ov1 = ov.convert_model(exp)
    print("  PASS")
except Exception as e:
    print(f"  FAIL: {type(e).__name__}: {str(e)[:100]}")

print("\n-- With reshape (0-D -> (1,)) --")
for module in model.modules():
    for pname, param in list(module._parameters.items()):
        if param is not None and param.dim() == 0:
            module._parameters[pname] = nn.Parameter(param.data.reshape(1), requires_grad=param.requires_grad)

print(f"  Scalar params after: {sum(1 for p in model.parameters() if p.dim() == 0)}")
try:
    exp2 = torch.export.export(model, args=(input_ids,), strict=False)
    ov2 = ov.convert_model(exp2)
    compiled = ov.compile_model(ov2)
    out = list(compiled({"input_ids": input_ids.numpy()}).values())[0]
    print(f"  inference OK — output shape: {out.shape}")
    print("  PASS")
except Exception as e:
    import traceback
    print(f"  FAIL: {type(e).__name__}: {str(e)[:200]}")
    traceback.print_exc()
