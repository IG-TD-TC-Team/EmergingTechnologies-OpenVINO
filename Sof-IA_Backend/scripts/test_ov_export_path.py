"""Test that torch.export.export + ov.convert_model handles vmap-based models.

Uses a tiny synthetic vmap model to avoid loading 16 GB of weights.
Run from repo root:  python scripts/test_ov_export_path.py
"""
import sys
sys.path.insert(0, ".")

import torch
import torch.nn as nn
import openvino as ov

print("OpenVINO version:", ov.__version__)
print("PyTorch version:", torch.__version__)


# ── Minimal model that uses vmap (same pattern as Apertus masking_utils) ──────

class VmapMaskModel(nn.Module):
    """A tiny model that uses torch.vmap in its forward pass,
    mirroring what Apertus does in create_causal_mask / sdpa_mask_recent_torch."""

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor):
        B, S = input_ids.shape

        # Simulate the vmap-based causal mask Apertus uses
        def make_row(q_idx):
            return torch.arange(S) <= q_idx

        causal = torch.vmap(make_row)(torch.arange(S))  # [S, S]
        causal = causal.unsqueeze(0).expand(B, -1, -1)   # [B, S, S]

        # Simple embedding + masked sum (stand-in for real attention)
        emb = input_ids.float().unsqueeze(-1).expand(-1, -1, S)  # [B, S, S]
        out = (emb * causal).sum(dim=-1)                          # [B, S]
        return out


model = VmapMaskModel().eval()
input_ids = torch.zeros(1, 8, dtype=torch.long)
attention_mask = torch.ones(1, 8, dtype=torch.long)

print("\n-- Method 1: ov.convert_model (TorchScript / ts_decoder) --")
try:
    ov1 = ov.convert_model(
        model,
        example_input={"input_ids": input_ids, "attention_mask": attention_mask},
    )
    print("  PASS")
except Exception as e:
    print(f"  FAIL — {type(e).__name__}: {str(e)[:120]}")

print("\n-- Method 2: torch.export.export -> ov.convert_model --")
try:
    exported = torch.export.export(
        model,
        args=(input_ids,),
        kwargs={"attention_mask": attention_mask},
        strict=False,
    )
    print(f"  export OK — graph nodes: {len(list(exported.graph.nodes))}")
    ov2 = ov.convert_model(exported)
    print("  ov.convert_model OK")
    # Quick inference check
    compiled = ov.compile_model(ov2)
    result = compiled({"input_ids": input_ids.numpy(), "attention_mask": attention_mask.numpy()})
    print(f"  inference OK — output shape: {list(result.values())[0].shape}")
    print("  PASS")
except Exception as e:
    import traceback
    print(f"  FAIL — {type(e).__name__}: {str(e)[:200]}")
    traceback.print_exc()

print("\nDone.")
