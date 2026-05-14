import logging
import threading
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Generator

from transformers import AutoTokenizer, TextIteratorStreamer
from optimum.intel import OVModelForCausalLM
from optimum.exporters.openvino import main_export

from src.benchmark.base import StreamingSLMBase
from src.benchmark.resources import check_ram, ov_thread_config, safe_thread_count

logger = logging.getLogger(__name__)

_MIN_FREE_RAM_BYTES = 4 * 1024 ** 3


def _is_stateful(model_path: Path) -> bool:
    """Return True if the exported OpenVINO model uses stateful KV cache."""
    xml = model_path / "openvino_model.xml"
    if not xml.exists():
        return True
    root = ET.parse(xml).getroot()
    return any(layer.get("type") == "Assign" for layer in root.iter("layer"))


def _patch_non_stateful(model) -> None:
    # optimum-intel _get_past_length crashes when past_key_values == () (empty
    # tuple), which is what non-stateful models return.  Treat it as None so
    # generation falls back to full-context mode.
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
    the model is downloaded from ``hub_id`` and exported to OpenVINO INT8
    format via ``main_export``.
    """

    def __init__(
        self,
        model_id: str,
        model_path: str,
        max_new_tokens: int = 512,
        hub_id: str = "",
        channel=None,
    ):
        super().__init__(model_id, model_path, max_new_tokens, channel)
        self.hub_id = hub_id
        self._tokenizer = None
        self._model = None

    def load(self) -> None:
        n_threads = safe_thread_count()
        self._report(f"OpenVINO inference thread count set to {n_threads}")
        check_ram(_MIN_FREE_RAM_BYTES, f"GenericSLMOpenVINO ({self.model_id})")

        local_path = Path(self.model_path)
        if not (local_path / "config.json").exists():
            src = self.hub_id or self.model_path
            self._report(
                f"model not found locally — downloading & exporting '{src}' "
                "to OpenVINO INT8 (this may take several minutes)"
            )
            local_path.mkdir(parents=True, exist_ok=True)
            main_export(
                model_name_or_path=src,
                output=str(local_path),
                task="text-generation-with-past",
                library_name="transformers",
            )
            self._report(f"export complete — model saved to '{self.model_path}'")

        self._tokenizer = AutoTokenizer.from_pretrained(self.model_path)
        self._model = OVModelForCausalLM.from_pretrained(
            self.model_path,
            ov_config=ov_thread_config(),
        )
        if not _is_stateful(local_path):
            logger.warning(
                "model_id=%s exported without stateful KV cache — "
                "generation runs in full-context mode (slower)",
                self.model_id,
            )
            _patch_non_stateful(self._model)

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