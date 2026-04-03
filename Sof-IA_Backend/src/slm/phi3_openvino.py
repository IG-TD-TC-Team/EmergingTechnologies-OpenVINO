import logging
import threading
from pathlib import Path
from typing import Generator

from transformers import AutoTokenizer, TextIteratorStreamer
from optimum.intel import OVModelForCausalLM
from optimum.exporters.openvino import main_export

from src.benchmark.base import StreamingSLMBase
from src.benchmark.resources import check_ram, ov_thread_config, safe_thread_count

logger = logging.getLogger(__name__)

# Phi-3 Mini 3.8B INT8 OpenVINO: ~4 GB peak RSS on load.
_MIN_FREE_RAM_BYTES = 6 * 1024 ** 3


class Phi3OpenVINO(StreamingSLMBase):
    """Phi-3 Mini 4k Instruct running on Intel OpenVINO (INT8 quantized, CPU).

    If ``model_path`` does not exist the model is first exported from
    ``hub_id`` via ``optimum-intel`` into the OpenVINO Intermediate
    Representation (IR) format with INT8 weight quantization, then saved to
    ``model_path`` for reuse.

    This is the **optimized** backend benchmarked against
    :class:`~src.slm.phi3_pytorch.Phi3PyTorch`.
    """

    def __init__(
        self,
        model_id: str,
        model_path: str,
        max_new_tokens: int = 512,
        hub_id: str = "microsoft/Phi-3-mini-4k-instruct",
        channel=None,
    ):
        """Initialize Phi3OpenVINO.

        Args:
            model_id: Registry key from ``config/models.yaml``
                (e.g. ``"phi3_openvino"``).
            model_path: Local directory containing (or that will receive)
                the exported OpenVINO IR model files.
            max_new_tokens: Maximum number of new tokens to generate per
                :meth:`run` call.
            hub_id: HuggingFace Hub repository ID used as the source when
                exporting the model for the first time.
            channel: Progress channel injected at construction.
        """
        super().__init__(model_id, model_path, max_new_tokens, channel)
        self.hub_id = hub_id
        self._tokenizer = None
        self._model = None

    def load(self) -> None:
        """Load the tokenizer and OpenVINO IR model into CPU memory.

        If ``model_path`` does not exist, the model is downloaded from
        ``hub_id``, exported to OpenVINO INT8 format via
        ``optimum.exporters.openvino.main_export``, and saved locally before
        loading.  This first-run export is slow (several minutes).  Subsequent
        calls load directly from the saved IR files.
        """
        n_threads = safe_thread_count()
        self._report(f"OpenVINO inference thread count set to {n_threads} (2 cores reserved for OS)")
        check_ram(_MIN_FREE_RAM_BYTES, "Phi3OpenVINO (INT8 3.8B)")

        local_path = Path(self.model_path)
        if not (local_path / "config.json").exists():
            self._report(
                f"model not found locally — downloading & exporting '{self.hub_id}' "
                "to OpenVINO INT8 (this may take several minutes)"
            )
            local_path.mkdir(parents=True, exist_ok=True)
            main_export(
                model_name_or_path=self.hub_id,
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

    def run(self, prompt: str) -> tuple[str, int]:
        """Run one greedy-decoding inference pass on the OpenVINO runtime.

        Args:
            prompt: Full formatted prompt string passed verbatim to the
                tokenizer.

        Returns:
            A tuple ``(generated_text, n_new_tokens)`` where
            ``generated_text`` is the model's response (input tokens
            stripped) and ``n_new_tokens`` is the number of tokens
            generated (used by the runner to compute ms/token metrics).
        """
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
        """Yield tokens one by one using TextIteratorStreamer in a background thread.

        ``OVModelForCausalLM`` supports ``TextIteratorStreamer`` the same way
        as a standard HuggingFace model.

        Args:
            prompt: Full formatted prompt string.

        Yields:
            Decoded token strings (one per generated token).

        Returns:
            ``(full_text, n_new_tokens)`` via ``StopIteration.value``.
        """
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