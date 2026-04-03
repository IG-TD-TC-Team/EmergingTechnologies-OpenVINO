import gc
import logging
import threading
from pathlib import Path
from typing import Generator

import torch
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
from optimum.intel import OVModelForCausalLM

from src.benchmark.base import StreamingSLMBase
from src.benchmark.resources import check_ram, ov_thread_config, patch_nncf_compat, safe_thread_count

logger = logging.getLogger(__name__)

# Export peak: BF16 base (~16 GB) + OV conversion/NNCF overhead ≈ 18–20 GB.
# Used as an advisory warning only (check_ram) — export is attempted regardless.
_MIN_FREE_RAM_EXPORT_BYTES = 16 * 1024 ** 3

# Load peak: INT4 model in memory ≈ 12 GB.
_MIN_FREE_RAM_LOAD_BYTES = 14 * 1024 ** 3

# OVWeightQuantizationConfig landed in optimum-intel ≥1.16.
try:
    from optimum.intel import OVWeightQuantizationConfig
    _QUANT_CONFIG_AVAILABLE = True
except ImportError:
    _QUANT_CONFIG_AVAILABLE = False

# Sentinel phrase from optimum-intel when a model type has no registered OnnxConfig.
_UNSUPPORTED_ARCH_PHRASE = "custom or unsupported architecture"


def _make_sdpa_mask_no_vmap():
    """Return a drop-in replacement for sdpa_mask_recent_torch that uses
    broadcasting instead of torch.vmap.

    torch.vmap cannot be captured by torch.jit.trace (used by optimum-intel's
    ONNX exporter).  This replacement produces an identical 4-D boolean mask
    [batch, 1, q_len, kv_len] via standard tensor broadcasting, which is
    fully compatible with TorchScript tracing.

    The mask_function contract is (batch_idx, head_idx, q_idx, kv_idx) → bool.
    All standard transformers mask functions (causal, sliding-window, chunked,
    padding) support broadcasting when passed tensor indices.
    """
    import transformers.masking_utils as _mu

    def _no_vmap(
        batch_size: int,
        cache_position: torch.Tensor,
        kv_length: int,
        kv_offset: int = 0,
        mask_function=None,
        attention_mask=None,
        local_size=None,
        allow_is_causal_skip: bool = True,
        **kwargs,
    ):
        if mask_function is None:
            mask_function = _mu.causal_mask_function

        q_length = cache_position.shape[0]
        padding_mask = _mu.prepare_padding_mask(attention_mask, kv_length, kv_offset, _slice=False)

        if allow_is_causal_skip and _mu._ignore_causal_mask_sdpa(
            padding_mask, q_length, kv_length, kv_offset, local_size
        ):
            return None

        kv_arange = torch.arange(kv_length, device=cache_position.device) + kv_offset

        if padding_mask is not None:
            mask_function = _mu.and_masks(mask_function, _mu.padding_mask_function(padding_mask))

        # Vectorise over (q, kv) via broadcasting — equivalent to _vmap_for_bhqkv
        # but without torch.vmap.  batch loop is negligible (Apertus uses batch=1).
        q_idx = cache_position.view(-1, 1)   # [q_len, 1]
        k_idx = kv_arange.view(1, -1)        # [1, kv_len]
        masks = []
        for b in range(batch_size):
            mask_2d = mask_function(b, 0, q_idx, k_idx)   # [q_len, kv_len]
            masks.append(mask_2d)

        return torch.stack(masks, dim=0).unsqueeze(1)  # [batch, 1, q_len, kv_len]

    return _no_vmap


class ApertusOpenVINO(StreamingSLMBase):
    """Apertus 8B Instruct running on Intel OpenVINO (INT4 quantized, CPU).

    Export strategy (first run only):

    1. **optimum-intel plain** ``OVModelForCausalLM(export=True)`` — fails for
       Apertus because it is not in optimum-intel's architecture registry.
    2. **optimum-intel + custom Mistral config + vmap patch** — calls
       ``main_export`` directly (bypassing ``_export`` which drops
       ``custom_export_configs``) with ``MistralOnnxConfig(use_past=True)``.
       Apertus is Mistral-family (GQA, RoPE, position_ids), so the Mistral
       ONNX config generates correct KV-cache I/O.  ``sdpa_mask_recent_torch``
       is monkeypatched to replace ``torch.vmap`` with broadcasting so the ONNX
       exporter's ``torch.jit.trace`` can capture the masking ops.  INT4
       quantization is embedded via ``OVConfig(quantization_config=INT4)``.
       Uses ``stateful=False`` (explicit ``past_key_values`` I/O) because
       ``stateful=True`` corrupts INT4 weight offsets to ``UINT64_MAX`` during
       OV's stateful conversion step.  ``OVModelForCausalLM`` handles both forms
       transparently — KV cache still works at full speed.

    3. **FX + KV cache** ``torch.export`` (strict=False) with a ``_KVWrapper``
       shim that converts the tuple-of-tuples ``past_key_values`` interface to
       the ``DynamicCache`` object the Apertus model requires, and converts back
       to tuple-of-tuples for output.  ``ov.convert_model`` converts the FX
       graph; the wrapper avoids negative cat-dims (OV validation) and avoids
       the ``DynamicLayer`` rank-1 initialisation artefact.  NNCF INT4 sym
       weight compression is applied after conversion.

    If all three tiers fail the export raises ``RuntimeError`` — the stateless
    NNCF fallback is deliberately disabled (no KV cache → O(n²) generation →
    unsuitable for benchmarking).

    Subsequent loads read directly from the saved IR files (~12 GB peak).
    """

    def __init__(
        self,
        model_id: str,
        model_path: str,
        max_new_tokens: int = 512,
        hub_id: str = "swiss-ai/Apertus-8B-Instruct-2509",
        channel=None,
    ):
        super().__init__(model_id, model_path, max_new_tokens, channel)
        self.hub_id = hub_id
        self._tokenizer = None
        self._model = None

    # ------------------------------------------------------------------
    # load
    # ------------------------------------------------------------------

    def load(self) -> None:
        """Load the tokenizer and OpenVINO IR model into CPU memory.

        Exports on first run (see class docstring for strategy).
        Subsequent calls load directly from the saved IR files.
        ``INFERENCE_NUM_THREADS`` is capped to ``cpu_count - 2``.
        """
        n_threads = safe_thread_count()
        self._report(f"OpenVINO inference thread count set to {n_threads} (2 cores reserved for OS)")

        local_path = Path(self.model_path)
        if not (local_path / "openvino_model.xml").exists():
            self._report(
                f"model not found locally — downloading & exporting '{self.hub_id}' "
                "to OpenVINO INT4 (this may take 20-60 minutes, ~22 GB RAM peak)"
            )
            local_path.mkdir(parents=True, exist_ok=True)
            check_ram(_MIN_FREE_RAM_EXPORT_BYTES, "ApertusOpenVINO export (INT4 quantization)")
            self._export(local_path)
            self._report(f"export complete — model saved to '{self.model_path}'")

        check_ram(_MIN_FREE_RAM_LOAD_BYTES, "ApertusOpenVINO load (INT4 8B)")
        self._tokenizer = AutoTokenizer.from_pretrained(self.model_path, trust_remote_code=True)
        self._model = OVModelForCausalLM.from_pretrained(
            self.model_path,
            ov_config=ov_thread_config(),
            trust_remote_code=True,
        )

    # ------------------------------------------------------------------
    # export helpers
    # ------------------------------------------------------------------

    def _export(self, local_path: Path) -> None:
        """Three-tier export strategy (see class docstring)."""
        quant_config = (
            OVWeightQuantizationConfig(bits=4, sym=True, ratio=1.0, group_size=-1)
            if _QUANT_CONFIG_AVAILABLE
            else None
        )
        if quant_config:
            self._report("quantization: INT4 sym per-channel (OVWeightQuantizationConfig)")
        else:
            self._report(
                "OVWeightQuantizationConfig not available — "
                "falling back to INT8 (upgrade optimum-intel>=1.16 for INT4)"
            )

        # --- Tier 1: plain optimum-intel (works for registered architectures) ---
        try:
            self._report("attempting optimum-intel export (OVModelForCausalLM)")
            export_model = OVModelForCausalLM.from_pretrained(
                self.hub_id,
                export=True,
                quantization_config=quant_config,
                torch_dtype="auto",
                trust_remote_code=True,
            )
            export_model.save_pretrained(str(local_path))
            AutoTokenizer.from_pretrained(self.hub_id, trust_remote_code=True).save_pretrained(str(local_path))
            del export_model
            gc.collect()
            return

        except Exception as exc:
            if _UNSUPPORTED_ARCH_PHRASE not in str(exc):
                raise
            self._report(
                "optimum-intel cannot export 'apertus' architecture — "
                "trying custom Mistral config + vmap patch"
            )

        # --- Tier 2: optimum-intel with custom Mistral config + vmap patch ---
        if self._export_optimum_patched(local_path, quant_config):
            return

        # --- Tier 3: FX-based KV cache export ---
        # main_export (Tier 2) uses torch.jit.trace, which embeds Apertus's
        # xIELU custom op as a TorchScript blob in the OV XML.  OV's C++
        # stoll cannot parse an integer constant in that blob, so the written
        # XML is unreadable.  The FX path (torch.export) decomposes all ops —
        # including xIELU — into ATen primitives, so no TorchScript blob is
        # embedded.  This mirrors what the NNCF fallback already does (which
        # is proven to work) but adds past_key_values I/O for O(n) decoding.
        if self._export_fx_kv(local_path, quant_config):
            return

        raise RuntimeError(
            "KV-cache export failed (all three export tiers failed). "
            "Check the logs above for the root cause."
        )

    def _export_optimum_patched(self, local_path: Path, quant_config) -> bool:
        """Export via main_export with a custom Mistral export config + KV cache.

        Apertus is architecturally identical to Mistral (GQA, RoPE, position_ids).
        ``MistralOnnxConfig(use_past=True)`` teaches optimum-intel how to build
        the KV-cache I/O and generate correct dummy inputs for Apertus.

        ``OVModelForCausalLM._export`` does not forward ``custom_export_configs``
        to ``main_export``, so we call ``main_export`` directly here.

        Two-step approach (mirrors what the CLI does):
        1. ``main_export`` with ``ov_config=None`` — writes BF16 OV IR to temp dir.
        2. ``_main_quantize`` on the exported dir — applies INT4 NNCF compression
           in-place.  This separates model tracing (step 1) from quantization
           (step 2), which is how the CLI avoids the corrupted-XML bug that
           occurs when NNCF INT4 is passed directly to ``main_export`` via
           ``ov_config``.

        The masking utility ``sdpa_mask_recent_torch`` (which internally calls
        ``torch.vmap``) is monkeypatched with a broadcasting equivalent before
        the export and restored afterwards.  ``torch.jit.trace`` — used by the
        optimum-intel ONNX exporter — cannot capture ``torch.vmap`` higher-order
        functions; the broadcasting replacement is functionally identical and
        TorchScript-compatible.

        ``_attn_implementation="eager"`` is passed to bypass the Apertus custom
        SDPA cache subclass (``DynamicCache`` with ``is_initialized``/``keys``
        sentinel attributes) whose methods are traced by TorchScript and produce
        int64 literal constants that OV's C++ ``stoll`` (``frontend.cpp:54``)
        cannot parse, raising ``stoll argument out of range``.

        Uses ``stateful=False`` (explicit ``past_key_values`` I/O) because
        ``stateful=True`` corrupts INT4 weight offsets to ``UINT64_MAX`` during
        OV's stateful conversion step.  ``OVModelForCausalLM`` handles both
        forms transparently — KV cache still works at full speed.

        Returns True on success, False if export fails (caller raises).
        """
        try:
            from optimum.exporters.onnx.model_configs import MistralOnnxConfig
            from optimum.exporters.openvino import main_export as ov_main_export
            from optimum.exporters.openvino.__main__ import _main_quantize
        except ImportError as exc:
            self._report(f"required import not available — skipping: {exc}")
            return False

        # _main_quantize calls NNCF internally.  Apply the compat patch now
        # (correct import: nncf.common.logging.logger.NNCFLogger, not nncf.common.logging).
        patch_nncf_compat()

        import transformers.masking_utils as _mu

        # Load the Apertus config to instantiate the OnnxConfig.
        apertus_config = AutoConfig.from_pretrained(self.hub_id, trust_remote_code=True)

        # Mistral OnnxConfig with use_past=True produces the full KV-cache I/O:
        # inputs: input_ids, attention_mask, past_key_values.N.{key,value}, position_ids
        # outputs: logits, present.N.{key,value}
        mistral_onnx_cfg = MistralOnnxConfig(
            apertus_config,
            task="text-generation",
            use_past=True,
            use_past_in_inputs=True,
        )

        # The CLI separates export and quantization into two steps:
        #   1. main_export (no quantization)  → produces BF16 OV IR
        #   2. _main_quantize               → applies INT4 NNCF compression
        # Passing ov_config with quantization to main_export does NOT trigger
        # _main_quantize automatically — it just skips _apply_model_size_based_quantization.
        # The NNCF INT4 pass must be called explicitly (step 2 below).

        # Patch sdpa_mask_recent_torch with the vmap-free broadcasting version.
        # ALL_MASK_ATTENTION_FUNCTIONS["sdpa"] is the live reference used by
        # create_causal_mask; patching the module attribute alone is not enough.
        _orig_mask = _mu.ALL_MASK_ATTENTION_FUNCTIONS["sdpa"]
        _no_vmap_mask = _make_sdpa_mask_no_vmap()
        _mu.ALL_MASK_ATTENTION_FUNCTIONS["sdpa"] = _no_vmap_mask
        _mu.sdpa_mask = _no_vmap_mask

        import shutil
        import tempfile

        try:
            self._report(
                "attempting optimum-intel export with KV cache "
                "(main_export + custom Mistral config + broadcasting mask)"
            )
            import os

            # Step 1: export BF16 OV IR to a temp dir (no quantization yet).
            # Using a temp dir keeps local_path clean if this step fails.
            with tempfile.TemporaryDirectory() as tmp_dir:
                export_exc = None
                try:
                    ov_main_export(
                        model_name_or_path=self.hub_id,
                        output=tmp_dir,
                        task="text-generation-with-past",
                        trust_remote_code=True,
                        custom_export_configs={"model": mistral_onnx_cfg},
                        ov_config=None,  # no quantization here — done in step 2
                        stateful=False,  # stateful=True corrupts INT4 weight offsets
                        model_loading_kwargs={
                            "torch_dtype": "auto",
                            # Bypass the custom SDPA cache implementation (DynamicCache
                            # subclass with is_initialized / keys sentinels) that produces
                            # int64 constants OV's TorchScript stoll cannot parse.
                            "_attn_implementation": "eager",
                        },
                    )
                except Exception as _e:
                    export_exc = _e

                # Always log temp dir contents (even on failure) for diagnostics.
                for entry in sorted(os.listdir(tmp_dir)):
                    try:
                        sz = os.path.getsize(os.path.join(tmp_dir, entry))
                    except OSError:
                        sz = -1
                    self._report(f"  export temp: {entry} ({sz:,} bytes)")

                if export_exc is not None:
                    # main_export sometimes writes valid OV IR files but then raises
                    # in a post-write step (stoll / XML mismatch in an internal reload).
                    # Verify the written model is loadable before giving up.
                    xml_path = os.path.join(tmp_dir, "openvino_model.xml")
                    bin_path = os.path.join(tmp_dir, "openvino_model.bin")
                    if (
                        os.path.exists(xml_path)
                        and os.path.getsize(xml_path) > 100_000   # > 100 KB
                        and os.path.exists(bin_path)
                        and os.path.getsize(bin_path) > 100_000_000  # > 100 MB
                    ):
                        import openvino as ov
                        try:
                            ov.Core().read_model(xml_path)
                            self._report(
                                f"ov_main_export raised {type(export_exc).__name__} "
                                "in post-write step but OV IR is valid — continuing"
                            )
                            export_exc = None  # treat as success
                        except Exception as verify_exc:
                            self._report(
                                f"OV IR invalid after export error "
                                f"({type(verify_exc).__name__}: {str(verify_exc)[:200]})"
                            )
                            raise export_exc
                    else:
                        raise export_exc

                # Copy BF16 model to final location.
                shutil.copytree(tmp_dir, local_path, dirs_exist_ok=True)

            # Step 2: apply INT4 compression via _main_quantize (reads from
            # local_path, overwrites with compressed model in place).
            if quant_config is not None:
                self._report("applying INT4 quantization via _main_quantize")
                _main_quantize(
                    model_name_or_path=self.hub_id,
                    task="text-generation-with-past",
                    library_name="transformers",
                    quantization_config=quant_config,
                    output=local_path,
                    cache_dir=None,
                    trust_remote_code=True,
                )

            AutoTokenizer.from_pretrained(
                self.hub_id, trust_remote_code=True
            ).save_pretrained(str(local_path))
            self._report("KV-cache export succeeded (main_export + Mistral config + INT4)")
            return True

        except Exception as exc:
            self._report(
                f"custom-config export failed ({type(exc).__name__}: {str(exc)[:300]})"
            )
            return False

        finally:
            # Always restore the original masking function.
            _mu.ALL_MASK_ATTENTION_FUNCTIONS["sdpa"] = _orig_mask
            _mu.sdpa_mask = _orig_mask

    def _export_fx_kv(self, local_path: Path, quant_config) -> bool:
        """FX-based (torch.export) KV-cache export.

        The TorchScript path used by ``main_export`` (Tier 2) embeds the
        Apertus xIELU custom activation as a TorchScript blob inside the OV
        XML.  OV's C++ ``std::stoll`` in ``frontend.cpp`` cannot parse an
        integer constant inside that blob, making the written XML unreadable.

        ``torch.export`` (FX) decomposes every op — including xIELU — into
        ATen-level primitives, so OV sees only native ops and no TorchScript
        blobs are embedded.  This is exactly what the NNCF fallback does
        (proven to work for Apertus), extended here to include
        ``past_key_values`` I/O so the exported model supports O(n) decoding.

        Export steps
        ------------
        1. Load base model (BF16) and reshape 0-D scalar buffers (same as
           NNCF fallback — OV FX decoder fails on 0-D numpy arrays).
        2. ``torch.export.export`` with empty ``past_key_values`` (seq_len=0)
           and ``Dim.AUTO`` for dynamic seq / past-seq dimensions.
        3. ``ov.convert_model(exported)`` → OV model in memory.
        4. Rename KV inputs/outputs so ``OVModelForCausalLM`` recognises them:
           inputs  → ``past_key_values.N.key`` / ``past_key_values.N.value``
           outputs → ``logits`` / ``present.N.key`` / ``present.N.value``
        5. ``nncf.compress_weights`` INT4 sym.
        6. ``ov.save_model``.

        Returns True on success, False on any error (caller raises).
        """
        import openvino as ov

        patch_nncf_compat()

        self._report("FX+KV export: loading config and tokenizer")
        config = AutoConfig.from_pretrained(self.hub_id, trust_remote_code=True)
        n_layers = config.num_hidden_layers
        n_kv_heads = config.num_key_value_heads
        head_dim = config.hidden_size // config.num_attention_heads
        self._report(
            f"FX+KV export: n_layers={n_layers} n_kv_heads={n_kv_heads} "
            f"head_dim={head_dim}"
        )

        tokenizer = AutoTokenizer.from_pretrained(self.hub_id, trust_remote_code=True)
        tokenizer.save_pretrained(str(local_path))
        config.save_pretrained(str(local_path))

        self._report("FX+KV export: loading base model in BF16 (~16 GB)")
        pt_model = AutoModelForCausalLM.from_pretrained(
            self.hub_id,
            dtype=torch.bfloat16,
            low_cpu_mem_usage=True,
            trust_remote_code=True,
        )
        pt_model.eval()

        # Reshape 0-D scalar Parameters and Buffers to (1,) — identical to
        # the NNCF fallback.  xIELU registers beta/eps as 0-D buffers;
        # OV's FX decoder calls np_array[0] which fails on ndim=0.
        n_reshaped = 0
        for module in pt_model.modules():
            for pname, param in list(module._parameters.items()):
                if param is not None and param.dim() == 0:
                    module._parameters[pname] = torch.nn.Parameter(
                        param.data.reshape(1), requires_grad=param.requires_grad
                    )
                    n_reshaped += 1
            for bname, buf in list(module._buffers.items()):
                if buf is not None and buf.dim() == 0:
                    module._buffers[bname] = buf.reshape(1)
                    n_reshaped += 1
        if n_reshaped:
            self._report(f"FX+KV export: reshaped {n_reshaped} scalar tensor(s) to (1,)")

        # Example inputs — use a multi-token (prefill-like) input to prevent
        # Dim.AUTO from specialising seq_len to range [0, 1].  Mistral-family
        # models have `if q_len == 1:` fast-paths that lock the dimension when
        # the example is a single token.  Using 8 tokens lets torch.export see
        # a more representative range, widening the specialisation bounds so
        # the exported model handles variable-length prompts at inference time.
        example = tokenizer(
            "Benchmark tracing input with several tokens", return_tensors="pt"
        )
        input_ids = example["input_ids"][:, :8]          # 8 tokens (prefill-like)
        seq_len = input_ids.shape[1]                      # 8 (or however many from tokenizer)
        past_seq = 8                                      # 8 past tokens in cache
        attention_mask = torch.ones(1, seq_len + past_seq, dtype=torch.long)
        position_ids = torch.arange(
            past_seq, past_seq + seq_len, dtype=torch.long
        ).unsqueeze(0)

        # Past KV with past_seq=8 — ensures the cat inside the model body
        # operates on non-zero tensors (OV's FX frontend rejects 0-size operands)
        # and gives Dim.AUTO a larger hint so specialisation covers seq > 1.
        kv_shape = (1, n_kv_heads, past_seq, head_dim)
        past_kv = tuple(
            (
                torch.zeros(kv_shape, dtype=torch.bfloat16),
                torch.zeros(kv_shape, dtype=torch.bfloat16),
            )
            for _ in range(n_layers)
        )

        seq_dim   = torch.export.Dim.AUTO
        past_dim  = torch.export.Dim.AUTO
        total_dim = torch.export.Dim.AUTO   # attention_mask covers seq + past

        # Apertus expects past_key_values to be a DynamicCache object (it calls
        # past_key_values.get_seq_length() internally).  DynamicCache is not a
        # pytree, so it cannot be used directly as a torch.export input.
        # This wrapper accepts past_key_values as a tuple-of-tuples (which IS a
        # pytree), constructs a DynamicCache from it inside forward(), calls the
        # model, then converts the updated cache back to a tuple-of-tuples for
        # the output.  torch.export sees only pytrees at the I/O boundary.
        class _KVWrapper(torch.nn.Module):
            def __init__(self_, inner):  # noqa: N805
                super().__init__()
                self_._inner = inner

            def forward(self_, input_ids, attention_mask, position_ids, past_key_values):  # noqa: N805
                from transformers.cache_utils import Cache, DynamicCache, DynamicLayer

                # Build DynamicCache from the tuple-of-tuples input WITHOUT
                # going through DynamicCache.__init__(ddp_cache_data=...).
                #
                # The normal path calls DynamicLayer.update() which first calls
                # lazy_initialization(), setting self.keys = torch.tensor([])
                # (rank-1, shape (0,)), then immediately cats rank-1 ⊕ rank-4
                # via torch.cat([self.keys, key_states], dim=-2).  OV's FX
                # frontend cannot convert that mixed-rank cat.
                #
                # We bypass this by constructing DynamicLayer objects and
                # directly setting their rank-4 keys/values attributes before
                # passing them to Cache.__init__(layers=...).  This is identical
                # to what lazy_initialization + first-update produces for a
                # non-empty past, minus the rank-1 empty tensor artefact.
                layers = []
                for key_states, value_states in past_key_values:
                    layer = DynamicLayer()
                    layer.dtype = key_states.dtype
                    layer.device = key_states.device
                    layer.is_initialized = True
                    layer.keys = key_states    # rank-4, no rank-1 init artefact
                    layer.values = value_states
                    layers.append(layer)

                # Construct DynamicCache using the base Cache.__init__(layers=)
                # path, which simply stores the pre-built layers without any
                # additional update() calls.
                cache = object.__new__(DynamicCache)
                Cache.__init__(cache, layers=layers)

                out = self_._inner(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    position_ids=position_ids,
                    past_key_values=cache,
                    use_cache=True,
                )
                updated_kv = out.past_key_values.to_legacy_cache()
                return out.logits, updated_kv

        wrapper = _KVWrapper(pt_model)

        # dynamic_shapes as a positional list matching wrapper.forward args
        # (input_ids, attention_mask, position_ids, past_key_values).
        pkv_shapes = tuple(({2: past_dim}, {2: past_dim}) for _ in range(n_layers))
        dynamic_shapes = [
            {1: seq_dim},    # input_ids
            {1: total_dim},  # attention_mask
            {1: seq_dim},    # position_ids
            pkv_shapes,      # past_key_values (tuple-of-tuples)
        ]

        self._report(
            "FX+KV export: tracing with torch.export (strict=False, "
            "dynamic seq + past dims)"
        )
        try:
            exported = torch.export.export(
                wrapper,
                args=(input_ids, attention_mask, position_ids, past_kv),
                strict=False,
                dynamic_shapes=dynamic_shapes,
            )
        except Exception as exc:
            self._report(
                f"FX+KV torch.export failed "
                f"({type(exc).__name__}: {str(exc)[:400]})"
            )
            return False

        # Post-process FX graph: normalise negative cat dims to positive.
        # OV 2026.x PyTorch FX frontend calls is_axis_valid(axis, rank) where
        # rank comes from the partial shape.  When rank is dynamic or unknown,
        # a negative dim fails the check even though it would be valid for a
        # concrete rank-4 tensor.  Converting dim=-2 → dim=2 (for 4-D tensors)
        # before passing to OV avoids the validation error.
        _fx_graph = exported.graph_module.graph
        _cat_fixed = 0
        for _n in _fx_graph.nodes:
            if (
                _n.op == "call_function"
                and _n.target is torch.ops.aten.cat.default
            ):
                _tensors_arg = _n.args[0]
                _dim_arg = _n.args[1] if len(_n.args) > 1 else _n.kwargs.get("dim", 0)
                if isinstance(_dim_arg, int) and _dim_arg < 0 and _tensors_arg:
                    _first = _tensors_arg[0]
                    _val = getattr(_first, "meta", {}).get("val")
                    if isinstance(_val, torch.Tensor) and _val.dim() > 0:
                        _new_dim = _dim_arg + _val.dim()
                        if _new_dim >= 0:
                            _new_args = list(_n.args)
                            _new_args[1] = _new_dim
                            _n.args = tuple(_new_args)
                            _cat_fixed += 1
        if _cat_fixed:
            _fx_graph.lint()
            self._report(
                f"FX+KV graph: normalised {_cat_fixed} negative cat dim(s) "
                "to positive for OV compatibility"
            )

        self._report("FX+KV export: converting FX graph to OV IR")
        try:
            ov_model = ov.convert_model(exported)
        except Exception as exc:
            self._report(
                f"FX+KV ov.convert_model failed "
                f"({type(exc).__name__}: {str(exc)[:1200]})"
            )
            return False

        # Reshape KV inputs to make n_kv_heads and head_dim static.
        # The FX export propagates shapes through DynamicLayer mutations, but
        # loses the concrete n_kv_heads value (shows as '?').  OVModelForCausalLM
        # prepare_inputs() calls dim.get_length() on all dims after setting
        # seq_len=0, so n_kv_heads must be a static integer (not '?').
        # We also reshape rank-2 inputs to [1, -1] so batch=1 is static.
        _kv_reshape: dict = {}
        for _inp in ov_model.inputs:
            _ps = _inp.get_partial_shape()
            if not _ps.rank.is_static:
                continue
            _rank = _ps.rank.get_length()
            _iname = _inp.get_any_name()
            if _rank == 4:
                _kv_reshape[_iname] = [1, n_kv_heads, -1, head_dim]
            elif _rank == 2:
                _kv_reshape[_iname] = [1, -1]
        if _kv_reshape:
            _n_kv_reshaped = sum(1 for v in _kv_reshape.values() if len(v) == 4)
            ov_model.reshape(_kv_reshape)
            self._report(
                f"FX+KV reshaped {_n_kv_reshaped} KV inputs "
                "to [1, n_kv_heads, -1, head_dim]"
            )

        # Log I/O for diagnostics before renaming.
        inp_names = [inp.get_any_name() for inp in ov_model.inputs]
        out_names = [out.get_any_name() for out in ov_model.outputs]
        self._report(
            f"FX+KV OV inputs  ({len(inp_names)}): "
            + ", ".join(inp_names[:8])
            + ("..." if len(inp_names) > 8 else "")
        )
        self._report(
            f"FX+KV OV outputs ({len(out_names)}): "
            + ", ".join(out_names[:5])
            + ("..." if len(out_names) > 5 else "")
        )

        # Rename I/O so OVModelForCausalLM can detect them:
        #   _has_cache_inputs  → looks for "past_key_values" in input names
        #   key_value_input_names  → [name for name in input_names if "key_values" in name]
        #   key_value_output_names → [name for name in output_names if "present" in name]
        #
        # Strategy: identify KV tensors by rank (4-D) and known dim sizes,
        # assign them names in layer order.  Non-KV inputs keep their names.
        # First output is logits (rank 3); remaining 4-D outputs are present KV.
        kv_in_idx = 0
        for inp in ov_model.inputs:
            ps = inp.get_partial_shape()
            if ps.rank.is_static and ps.rank.get_length() == 4:
                layer = kv_in_idx // 2
                slot = "key" if kv_in_idx % 2 == 0 else "value"
                inp.tensor.set_names({f"past_key_values.{layer}.{slot}"})
                kv_in_idx += 1

        logits_named = False
        kv_out_idx = 0
        for out in ov_model.outputs:
            ps = out.get_partial_shape()
            rank = ps.rank.get_length() if ps.rank.is_static else None
            if rank == 3 and not logits_named:
                out.tensor.set_names({"logits"})
                logits_named = True
            elif rank == 4:
                layer = kv_out_idx // 2
                slot = "key" if kv_out_idx % 2 == 0 else "value"
                out.tensor.set_names({f"present.{layer}.{slot}"})
                kv_out_idx += 1

        self._report(
            f"FX+KV renamed: {kv_in_idx} KV inputs, "
            f"{kv_out_idx} KV outputs, logits={'yes' if logits_named else 'NO'}"
        )
        if not logits_named or kv_in_idx == 0 or kv_out_idx == 0:
            self._report(
                "FX+KV export: I/O renaming incomplete — "
                f"OV I/O structure unexpected (inputs={inp_names}, "
                f"outputs={out_names[:5]})"
            )
            return False

        # Free PyTorch model before compression to keep peak RAM manageable.
        del pt_model
        gc.collect()

        import nncf

        if quant_config is not None:
            self._report("FX+KV export: applying NNCF INT4 sym compression")
            ov_model = nncf.compress_weights(
                ov_model,
                mode=nncf.CompressWeightsMode.INT4_SYM,
                ratio=1.0,
                group_size=-1,
            )
        else:
            self._report(
                "FX+KV export: OVWeightQuantizationConfig unavailable — "
                "saving INT8 compressed model"
            )
            ov_model = nncf.compress_weights(
                ov_model,
                mode=nncf.CompressWeightsMode.INT8_SYM,
            )

        ov.save_model(ov_model, str(local_path / "openvino_model.xml"))
        self._report("FX+KV export succeeded")
        return True

    def _export_nncf_fallback(self, local_path: Path, quant_config) -> None:
        """Export via PyTorch trace → OpenVINO IR → NNCF INT4 weight compression.

        Stateless export (no KV cache).  Sets ``.no_kv_cache`` sentinel so the
        load path uses ``use_cache=False``.

        Works for any architecture regardless of optimum-intel support.
        Frees the PyTorch model from memory before the compression step to
        keep peak RAM near 22 GB.

        ``patch_nncf_compat()`` is applied before model loading to fix a
        ``TypeError`` in older NNCF builds where ``warning_once`` does not
        accept format-string arguments.
        """
        patch_nncf_compat()
        import openvino as ov

        # Save tokenizer and HuggingFace config (cheap, architecture-independent).
        self._report("saving tokenizer and config")
        tokenizer = AutoTokenizer.from_pretrained(self.hub_id, trust_remote_code=True)
        tokenizer.save_pretrained(str(local_path))
        AutoConfig.from_pretrained(self.hub_id, trust_remote_code=True).save_pretrained(str(local_path))

        # Load base model in BF16 (~16 GB).
        self._report("loading base model in BF16 for OV tracing (~16 GB)")
        pt_model = AutoModelForCausalLM.from_pretrained(
            self.hub_id,
            dtype=torch.bfloat16,
            low_cpu_mem_usage=True,
            trust_remote_code=True,
        )
        pt_model.eval()

        # Reshape 0-D (scalar) Parameters AND Buffers to (1,) before tracing.
        # xIELU's beta and eps are register_buffer("beta", torch.tensor(0.5)) — 0-D.
        # OV's FX decoder (torch_tensor_to_ov_const) indexes the numpy array
        # with [0] which fails on ndim=0 arrays.  Reshaping to (1,) is safe:
        # PyTorch broadcasting produces identical results in arithmetic ops.
        n_reshaped = 0
        for module in pt_model.modules():
            for pname, param in list(module._parameters.items()):
                if param is not None and param.dim() == 0:
                    module._parameters[pname] = torch.nn.Parameter(
                        param.data.reshape(1), requires_grad=param.requires_grad
                    )
                    n_reshaped += 1
            for bname, buf in list(module._buffers.items()):
                if buf is not None and buf.dim() == 0:
                    module._buffers[bname] = buf.reshape(1)
                    n_reshaped += 1
        if n_reshaped:
            self._report(f"reshaped {n_reshaped} scalar tensor(s) to (1,) for OV export")

        # Trace to OpenVINO IR via torch.export (FX-based, handles vmap natively).
        # dynamic_shapes with Dim.AUTO: lets torch.export infer the valid seq_len
        # constraint range rather than checking a user-supplied range against the
        # trivially-satisfied guard min(128*S, 512*S)==128*S that causes a
        # ConstraintViolationError with explicit max=32768.
        example = tokenizer("Benchmark input text for model tracing", return_tensors="pt")
        seq_dim = torch.export.Dim.AUTO
        dynamic_shapes = {
            "input_ids": {1: seq_dim},
            "attention_mask": {1: seq_dim},
        }
        try:
            self._report("tracing to OpenVINO IR (torch.export dynamic + ov.convert_model)")
            exported = torch.export.export(
                pt_model,
                args=(example["input_ids"],),
                kwargs={"attention_mask": example["attention_mask"]},
                strict=False,
                dynamic_shapes=dynamic_shapes,
            )
            ov_model = ov.convert_model(exported)
        except Exception as exc:
            self._report(
                f"torch.export failed ({type(exc).__name__}) — "
                "retrying with TorchScript trace (ov.convert_model)"
            )
            ov_model = ov.convert_model(
                pt_model,
                example_input={
                    "input_ids": example["input_ids"],
                    "attention_mask": example["attention_mask"],
                },
            )

        # Rename OV outputs so OVModelForCausalLM.forward() can find them.
        # torch.export assigns FX-graph node names; optimum-intel expects "logits".
        _out_names_before = [sorted(o.get_names()) for o in ov_model.outputs]
        self._report(f"OV model outputs before rename: {_out_names_before}")
        if ov_model.outputs and not any("logits" in names for names in _out_names_before):
            ov_model.outputs[0].tensor.set_names({"logits"})
            self._report("renamed output[0] → 'logits'")

        # Free the 16 GB PyTorch model before the compression pass.
        del pt_model
        gc.collect()

        # Import nncf only now — after the PyTorch model is gone — to avoid
        # its import-time patches conflicting with the Apertus model loader.
        import nncf

        # INT4 weight compression via NNCF (weight-only, no calibration data needed).
        if quant_config is not None:
            self._report("applying NNCF INT4 sym weight compression")
            ov_model = nncf.compress_weights(
                ov_model,
                mode=nncf.CompressWeightsMode.INT4_SYM,
                ratio=1.0,
                group_size=-1,
            )
        else:
            self._report("NNCF INT4 unavailable — saving uncompressed OV IR (INT8 via nncf)")
            ov_model = nncf.compress_weights(
                ov_model,
                mode=nncf.CompressWeightsMode.INT8_SYM,
            )

        ov.save_model(ov_model, str(local_path / "openvino_model.xml"))
        # Mark that this export has no KV-cache IR (OVModelForCausalLM needs use_cache=False).
        (local_path / ".no_kv_cache").touch()
        self._report("nncf fallback export saved")

    # ------------------------------------------------------------------
    # inference
    # ------------------------------------------------------------------

    def run(self, prompt: str) -> tuple[str, int]:
        """Run one greedy-decoding inference pass on the OpenVINO runtime."""
        inputs = self._tokenizer(prompt, return_tensors="pt")
        n_input_tokens = inputs["input_ids"].shape[-1]
        outputs = self._model.generate(
            **inputs, max_new_tokens=self.max_new_tokens, do_sample=False,
            repetition_penalty=1.1,
        )
        n_new_tokens = outputs.shape[-1] - n_input_tokens
        text = self._tokenizer.decode(
            outputs[0][n_input_tokens:], skip_special_tokens=True
        )
        return text, n_new_tokens

    def run_streaming(self, prompt: str) -> Generator[str, None, tuple[str, int]]:
        """Yield tokens one by one using TextIteratorStreamer in a background thread."""
        inputs = self._tokenizer(prompt, return_tensors="pt")
        streamer = TextIteratorStreamer(
            self._tokenizer, skip_prompt=True, skip_special_tokens=True
        )
        gen_kwargs = {
            **inputs,
            "max_new_tokens": self.max_new_tokens,
            "do_sample": False,
            "repetition_penalty": 1.1,
            "streamer": streamer,
        }
        thread = threading.Thread(target=self._model.generate, kwargs=gen_kwargs)
        thread.start()

        tokens: list[str] = []
        for token in streamer:
            tokens.append(token)
            yield token

        thread.join()
        full_text = "".join(tokens)
        n_new_tokens = len(tokens)
        return full_text, n_new_tokens

    def unload(self) -> None:
        """Delete model and tokenizer objects and free CPU memory."""
        del self._model
        del self._tokenizer
        self._model = None
        self._tokenizer = None
