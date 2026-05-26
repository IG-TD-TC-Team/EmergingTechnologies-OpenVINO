import logging
import shutil
import threading
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Generator

from transformers import AutoTokenizer, TextIteratorStreamer
from optimum.intel import OVModelForCausalLM
from optimum.exporters.openvino import main_export

from src.benchmark.base import StreamingSLMBase
from src.benchmark.resources import check_ram, ov_thread_config, safe_thread_count, sdpa_no_vmap

logger = logging.getLogger(__name__)

_MIN_FREE_RAM_BYTES = 4 * 1024 ** 3


def _is_stateful(model_path: Path) -> bool:
    """Return True if the exported OpenVINO model uses stateful KV cache (Assign nodes)."""
    xml = model_path / "openvino_model.xml"
    if not xml.exists():
        return False
    root = ET.parse(xml).getroot()
    return any(layer.get("type") == "Assign" for layer in root.iter("layer"))


def _has_kv_cache(model_path: Path) -> bool:
    """Return True if the model supports any form of KV caching.

    Returns True for:
    - Stateful models (Assign nodes present)
    - Stateless models with explicit past_key_values inputs

    Returns False only for models exported without KV cache at all (full-context
    mode), which are very rare with the current ``text-generation-with-past`` task.
    """
    xml_path = model_path / "openvino_model.xml"
    if not xml_path.exists():
        return False
    root = ET.parse(xml_path).getroot()
    for layer in root.iter("layer"):
        if layer.get("type") == "Assign":
            return True  # stateful: internal KV state
        if layer.get("type") == "Parameter":
            for port in layer.iter("port"):
                if "past_key_values" in port.get("names", ""):
                    return True  # stateless: explicit KV I/O
    return False


def _patch_non_stateful(model) -> None:
    """Patch ``_get_past_length`` to handle models that return an empty past tuple.

    optimum-intel ``_get_past_length`` crashes when ``past_key_values == ()``
    (empty tuple), which happens for models exported without any KV cache.
    Treating it as ``None`` causes generation to fall back to full-context mode.
    """
    orig = type(model)._get_past_length

    def _safe_get_past_length(self, past_key_values=None):
        if past_key_values is not None and len(past_key_values) == 0:
            past_key_values = None
        return orig(self, past_key_values)

    import types
    model._get_past_length = types.MethodType(_safe_get_past_length, model)


class GenericSLMOpenVINO(StreamingSLMBase):
    """Generic OpenVINO causal-LM wrapper for standard transformers models.

    Works for any architecture supported by ``optimum-intel``
    (LLaMA, Qwen, Mistral-simple, etc.).  If ``model_path`` does not exist
    the model is downloaded from ``hub_id`` and exported to OpenVINO using the
    compression level specified by ``compression`` ("int8" or "int4").

    GQA workaround
    --------------
    OpenVINO 2026.x ``ScaledDotProductAttentionWithKVCache`` has an
    attention-mask shape bug for GQA models
    (``num_attention_heads != num_key_value_heads``): the 4-D mask is produced
    with first dim = ``num_kv_heads`` instead of ``batch_size``, causing a
    shape-mismatch RuntimeError at inference time.

    The workaround is to export GQA models as *stateless* (explicit KV I/O,
    ``stateful=False``) so the broken OV node is never inserted.  If an existing
    stateful export is detected for a GQA model, it is automatically deleted
    and re-exported as stateless on the next load.

    vmap workaround
    ---------------
    ``transformers >= 4.50`` calls ``torch.vmap`` inside
    ``sdpa_mask_recent_torch``.  ``torch.jit.trace`` (used by the optimum-intel
    ONNX exporter) cannot capture ``torch.vmap``.  Two-layer defence:

    - ``_attn_implementation="eager"`` via ``model_loading_kwargs`` — primary
      fix; prevents ``create_causal_mask`` from selecting the SDPA+vmap path.
    - :func:`sdpa_no_vmap` context manager — defence-in-depth for models that
      set ``_attn_implementation`` at layer level.
    """

    def __init__(
        self,
        model_id: str,
        model_path: str,
        max_new_tokens: int = 512,
        hub_id: str = "",
        compression: str = "int8",
        channel=None,
    ):
        super().__init__(model_id, model_path, max_new_tokens, channel)
        self.hub_id = hub_id
        self.compression = compression.lower()  # "int8" or "int4"
        self._tokenizer = None
        self._model = None

    def load(self) -> None:
        n_threads = safe_thread_count()
        self._report(f"OpenVINO inference thread count set to {n_threads}")
        check_ram(_MIN_FREE_RAM_BYTES, f"GenericSLMOpenVINO ({self.model_id})")

        local_path = Path(self.model_path)

        # ── GQA + stateful export bug detection ──────────────────────────────
        # OV 2026.x ScaledDotProductAttentionWithKVCache creates the 4-D
        # attention mask with shape (num_kv_heads, 1, q_len, kv_len) for GQA
        # models, but the node expects (batch, 1, q_len, kv_len).  The mismatch
        # triggers:
        #   RuntimeError: attention_mask do not match q and k,
        #   query_dims:(B.Hq.S.D) ... attn_mask_dims:(Hkv.1.S.S)
        #
        # Detect this combination early: if the existing export is stateful AND
        # the saved config reports GQA (num_q ≠ num_kv), delete it so the
        # model is re-exported below as stateless (explicit KV I/O), which
        # bypasses the broken node entirely.
        if _is_stateful(local_path) and (local_path / "config.json").exists():
            try:
                from transformers import AutoConfig
                cfg = AutoConfig.from_pretrained(str(local_path), trust_remote_code=True)
                n_q  = getattr(cfg, "num_attention_heads", 0)
                n_kv = getattr(cfg, "num_key_value_heads", n_q)
                if n_q != n_kv:
                    self._report(
                        f"GQA model detected (num_attention_heads={n_q}, "
                        f"num_key_value_heads={n_kv}) with stateful OV export. "
                        "OV 2026.x ScaledDotProductAttentionWithKVCache has an "
                        "attention-mask shape bug for GQA — deleting cached "
                        "stateful export and re-exporting as stateless "
                        "(explicit KV I/O) to work around the issue."
                    )
                    shutil.rmtree(local_path)
            except Exception as exc:
                logger.debug("GQA stateful-export check failed: %s", exc)

        if not (local_path / "config.json").exists():
            src = self.hub_id or self.model_path
            local_path.mkdir(parents=True, exist_ok=True)
            if self.compression == "int4":
                self._export_int4(src, local_path)
            else:
                self._export_int8(src, local_path)
            self._report(f"export complete — model saved to '{self.model_path}'")

        self._tokenizer = AutoTokenizer.from_pretrained(self.model_path)

        # Determine whether to load as stateful (existing stateful export that
        # survived the GQA check above) or stateless (new explicit-KV export).
        # Stateless exports must be loaded with stateful=False to prevent
        # optimum-intel from auto-converting them to stateful on the fly, which
        # would re-introduce the OV 2026.x GQA shape bug.
        already_stateful = _is_stateful(local_path)
        load_kwargs = {} if already_stateful else {"stateful": False}
        self._model = OVModelForCausalLM.from_pretrained(
            self.model_path,
            ov_config=ov_thread_config(),
            **load_kwargs,
        )

        if not _has_kv_cache(local_path):
            logger.warning(
                "model_id=%s exported without KV cache — "
                "generation runs in full-context mode (slower)",
                self.model_id,
            )
            _patch_non_stateful(self._model)

    # ── Export helpers ────────────────────────────────────────────────────────

    def _export_int8(self, src: str, local_path: Path) -> None:
        """Export to OpenVINO INT8 (stateless, vmap-free).

        Uses ``main_export`` with:
        - ``stateful=False`` — avoids GQA attention-mask shape bug in OV 2026.x.
        - ``_attn_implementation="eager"`` — primary vmap fix; prevents
          ``create_causal_mask`` from selecting the SDPA+vmap path during tracing.
        - :func:`sdpa_no_vmap` — defence-in-depth for layer-level overrides.
        """
        self._report(f"Exporting '{src}' to OpenVINO INT8 (this may take 5–15 min)...")
        with sdpa_no_vmap():
            main_export(
                model_name_or_path=src,
                output=str(local_path),
                task="text-generation-with-past",
                library_name="transformers",
                stateful=False,
                model_loading_kwargs={
                    "_attn_implementation": "eager",
                    "torch_dtype": "auto",
                },
            )
        self._report("INT8 export complete.")

    def _export_int4(self, src: str, local_path: Path) -> None:
        """Export to OpenVINO INT4 weight-compressed (stateless, vmap-free).

        Uses ``OVModelForCausalLM.from_pretrained(export=True, ...)`` with
        ``OVWeightQuantizationConfig(bits=4, group_size=128)`` and
        ``stateful=False`` to bypass the OV 2026.x GQA mask-shape bug.

        Falls back to INT8 if:
        - ``OVWeightQuantizationConfig`` is not available (old optimum-intel).
        - The OV FX frontend hits an integer-overflow bug (``stoll`` error).
        """
        try:
            from optimum.intel import OVWeightQuantizationConfig
            quant_config = OVWeightQuantizationConfig(bits=4, sym=True, ratio=1.0, group_size=128)
        except ImportError:
            self._report("OVWeightQuantizationConfig unavailable — falling back to INT8")
            self._export_int8(src, local_path)
            return

        self._report(f"Exporting '{src}' to OpenVINO INT4 (this may take 10–30 min)...")
        try:
            with sdpa_no_vmap():
                model = OVModelForCausalLM.from_pretrained(
                    src,
                    export=True,
                    quantization_config=quant_config,
                    stateful=False,
                )
        except Exception as exc:
            exc_str = str(exc)
            if "stoll argument out of range" in exc_str or "frontends/common" in exc_str.replace("\\", "/"):
                self._report(
                    "INT4 export hit an OpenVINO integer-overflow bug for this "
                    "architecture — falling back to INT8."
                )
                self._export_int8(src, local_path)
                return
            raise
        self._report("Saving OpenVINO INT4 IR files...")
        model.save_pretrained(str(local_path))
        self._report("Saving tokenizer...")
        tok = AutoTokenizer.from_pretrained(src)
        tok.save_pretrained(str(local_path))
        self._report("INT4 export complete.")

    def run(self, prompt: str) -> tuple[str, int]:
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
        return "".join(tokens), len(tokens)

    def unload(self) -> None:
        del self._model
        del self._tokenizer
        self._model = None
        self._tokenizer = None