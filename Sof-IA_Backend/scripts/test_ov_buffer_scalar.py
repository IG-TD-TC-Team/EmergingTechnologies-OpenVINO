"""Verify the buffer reshape fix resolves the 0-D scalar buffer OV export failure.

xIELU uses register_buffer("beta", torch.tensor(0.5)) — NOT nn.Parameter.
Run from repo root:  python scripts/test_ov_buffer_scalar.py
"""
import sys
sys.path.insert(0, ".")

import torch
import torch.nn as nn
import openvino as ov


class XIELULike(nn.Module):
    """Mirrors XIELUActivation.beta: a 0-D scalar registered as a buffer."""
    def __init__(self):
        super().__init__()
        self.register_buffer("beta", torch.tensor(0.5))

    def forward(self, x):
        return x * (1.0 + self.beta * x).sigmoid()


class MLP(nn.Module):
    def __init__(self, d):
        super().__init__()
        self.fc = nn.Linear(d, d)
        self.act = XIELULike()

    def forward(self, x):
        return self.act(self.fc(x))


class DecoderLayer(nn.Module):
    def __init__(self, d):
        super().__init__()
        self.mlp = MLP(d)

    def forward(self, x):
        return self.mlp(x)


class BufferScalarModel(nn.Module):
    """Nested 0-D scalar buffers in multiple layers — mirrors Apertus xIELU."""
    def __init__(self, d=64, n_layers=2):
        super().__init__()
        self.layers = nn.ModuleList([DecoderLayer(d) for _ in range(n_layers)])

    def forward(self, input_ids: torch.Tensor):
        x = input_ids.float().unsqueeze(-1).expand(-1, -1, 64).clone()
        for layer in self.layers:
            x = layer(x)
        return x.mean(dim=-1)


model = BufferScalarModel().eval()
input_ids = torch.zeros(1, 8, dtype=torch.long)
n_scalar_buf = sum(1 for m in model.modules() for b in m._buffers.values() if b is not None and b.dim() == 0)
n_scalar_par = sum(1 for p in model.parameters() if p.dim() == 0)
print(f"0-D buffers before fix: {n_scalar_buf}")
print(f"0-D params before fix:  {n_scalar_par}")

print("\n-- Without reshape (should FAIL) --")
try:
    exp = torch.export.export(model, args=(input_ids,), strict=False)
    ov1 = ov.convert_model(exp)
    print("  PASS (no reshape needed)")
except Exception as e:
    print(f"  FAIL as expected: {type(e).__name__}: {str(e)[:120]}")

print("\n-- With buffer reshape (0-D -> (1,)) --")
n_reshaped = 0
for module in model.modules():
    for pname, param in list(module._parameters.items()):
        if param is not None and param.dim() == 0:
            module._parameters[pname] = nn.Parameter(param.data.reshape(1), requires_grad=param.requires_grad)
            n_reshaped += 1
    for bname, buf in list(module._buffers.items()):
        if buf is not None and buf.dim() == 0:
            module._buffers[bname] = buf.reshape(1)
            n_reshaped += 1

print(f"  reshaped {n_reshaped} scalar tensor(s)")
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
