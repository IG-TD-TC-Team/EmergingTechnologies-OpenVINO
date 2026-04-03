import logging
import threading
from pathlib import Path
from typing import Generator

from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer

from src.benchmark.base import StreamingSLMBase
from src.benchmark.resources import apply_pytorch_thread_limit, check_ram

logger = logging.getLogger(__name__)

# Phi-3 Mini 3.8B loaded in FP32 on CPU: ~15 GB peak RSS.
_MIN_FREE_RAM_BYTES = 16 * 1024 ** 3


class Phi3PyTorch(StreamingSLMBase):
    """Phi-3 Mini 4k Instruct running on PyTorch CPU.

    Weights are loaded from ``model_path``.  If the path does not exist the
    model is downloaded from HuggingFace Hub (``hub_id``) and saved locally on
    first use.  Subsequent runs load directly from disk.

    This is the **baseline** backend used to compare against
    :class:`~src.slm.phi3_openvino.Phi3OpenVINO`.
    """

    def __init__(
        self,
        model_id: str,
        model_path: str,
        max_new_tokens: int = 512,
        hub_id: str = "microsoft/Phi-3-mini-4k-instruct",
        channel=None,
    ):
        """Initialize Phi3PyTorch.

        Args:
            model_id: Registry key from ``config/models.yaml``
                (e.g. ``"phi3_pytorch"``).
            model_path: Local directory that contains (or will receive) the
                model weights and tokenizer files.
            max_new_tokens: Maximum number of new tokens to generate per
                :meth:`run` call.
            hub_id: HuggingFace Hub repository ID used when ``model_path``
                does not exist and the model must be downloaded.
            channel: Progress channel injected at construction.
        """
        super().__init__(model_id, model_path, max_new_tokens, channel)
        self.hub_id = hub_id
        self._tokenizer = None
        self._model = None

    def load(self) -> None:
        """Load the tokenizer and model weights into CPU memory.

        If ``model_path`` does not exist on disk the model is downloaded from
        ``hub_id`` and saved before loading.  This is a blocking, potentially
        slow operation — progress is reported via :meth:`_report`.
        """
        n_threads = apply_pytorch_thread_limit()
        self._report(f"PyTorch thread count set to {n_threads} (2 cores reserved for OS)")
        check_ram(_MIN_FREE_RAM_BYTES, "Phi3PyTorch (FP32 3.8B)")

        local_path = Path(self.model_path)
        if not (local_path / "config.json").exists():
            self._report(
                f"model not found locally — downloading '{self.hub_id}' "
                "from HuggingFace (this may take several minutes)"
            )
            local_path.mkdir(parents=True, exist_ok=True)
            tokenizer = AutoTokenizer.from_pretrained(self.hub_id)
            tokenizer.save_pretrained(self.model_path)
            model = AutoModelForCausalLM.from_pretrained(self.hub_id)
            model.save_pretrained(self.model_path)
            self._report(f"download complete — model saved to '{self.model_path}'")

        self._tokenizer = AutoTokenizer.from_pretrained(self.model_path)
        self._model = AutoModelForCausalLM.from_pretrained(self.model_path)

    def run(self, prompt: str) -> tuple[str, int]:
        """Run one greedy-decoding inference pass.

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