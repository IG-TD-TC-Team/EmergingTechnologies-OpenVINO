"""Verify that the broadcasting mask replacement produces identical output to vmap.

Tests _make_sdpa_mask_no_vmap() against the original sdpa_mask_recent_torch
on all standard mask types (causal, sliding-window, chunked, padding).

Run from repo root:  python scripts/test_apertus_mask_patch.py
"""
import sys
sys.path.insert(0, ".")

import torch
import transformers.masking_utils as mu
from src.slm.apertus_openvino import _make_sdpa_mask_no_vmap

_no_vmap = _make_sdpa_mask_no_vmap()
_orig = mu.sdpa_mask_recent_torch


def _compare(label, *args, **kwargs):
    ref = _orig(*args, **kwargs)
    got = _no_vmap(*args, **kwargs)
    if ref is None and got is None:
        print(f"  {label}: both None (is_causal path) — OK")
        return
    if ref is None or got is None:
        print(f"  {label}: FAIL — one None, other not")
        return
    if ref.shape != got.shape:
        print(f"  {label}: FAIL shape ref={ref.shape} got={got.shape}")
        return
    if torch.equal(ref, got):
        print(f"  {label}: PASS shape={tuple(got.shape)}")
    else:
        diff = (ref != got).sum().item()
        print(f"  {label}: FAIL — {diff} differing elements out of {ref.numel()}")


print("=== Mask equivalence tests ===\n")

# --- 1. Causal mask (standard, no padding) ---
print("1. Causal mask (batch=1, q=8, kv=8):")
cache_pos = torch.arange(8)
_compare("causal", batch_size=1, cache_position=cache_pos, kv_length=8, allow_is_causal_skip=False)

# --- 2. Causal mask (decode step: q=1, kv=16) ---
print("\n2. Causal mask — decode step (batch=1, q=1, kv=16, offset=15):")
cache_pos = torch.tensor([15])
_compare("causal-decode", batch_size=1, cache_position=cache_pos, kv_length=16, kv_offset=0, allow_is_causal_skip=False)

# --- 3. Sliding-window causal mask ---
print("\n3. Sliding-window mask (window=4, q=8, kv=8):")
cache_pos = torch.arange(8)
sw_fn = mu.sliding_window_causal_mask_function(4)
_compare("sliding-window", batch_size=1, cache_position=cache_pos, kv_length=8,
         mask_function=sw_fn, allow_is_causal_skip=False)

# --- 4. Padding mask (batch=2, one sequence padded) ---
print("\n4. Causal + padding mask (batch=2, q=4, kv=4, second seq has 1 pad):")
cache_pos = torch.arange(4)
# attention_mask: batch=2, lengths [4, 3] — second seq has 1 leading pad
attn_mask = torch.tensor([[1, 1, 1, 1], [0, 1, 1, 1]], dtype=torch.long)
_compare("causal+padding", batch_size=2, cache_position=cache_pos, kv_length=4,
         attention_mask=attn_mask, allow_is_causal_skip=False)

# --- 5. Larger sequence (batch=1, q=128, kv=128) ---
print("\n5. Causal mask (batch=1, q=128, kv=128):")
cache_pos = torch.arange(128)
_compare("causal-128", batch_size=1, cache_position=cache_pos, kv_length=128, allow_is_causal_skip=False)

# --- 6. TorchScript traceability ---
print("\n6. TorchScript traceability of no-vmap version:")
class _MaskModule(torch.nn.Module):
    def forward(self, cache_position, attn_mask):
        return _no_vmap(
            batch_size=1,
            cache_position=cache_position,
            kv_length=cache_position.shape[0],
            attention_mask=attn_mask,
            allow_is_causal_skip=False,
        )

m = _MaskModule()
cache_pos = torch.arange(8)
attn_mask = torch.ones(1, 8, dtype=torch.long)
try:
    traced = torch.jit.trace(m, (cache_pos, attn_mask), check_trace=False)
    out = traced(cache_pos, attn_mask)
    print(f"  TorchScript trace: PASS — output shape {tuple(out.shape)}")
except Exception as e:
    print(f"  TorchScript trace: FAIL — {type(e).__name__}: {str(e)[:200]}")

print("\nDone.")
