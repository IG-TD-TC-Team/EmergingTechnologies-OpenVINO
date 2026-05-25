import logging
import threading
from pathlib import Path
from typing import Generator

from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer

from src.benchmark.base import StreamingSLMBase
from src.benchmark.resources import apply_pytorch_thread_limit, check_ram

logger = logging.getLogger(__name__)

_MIN_FREE_RAM_BYTES = 8 * 1024 ** 3


class GenericSLMPyTorch(StreamingSLMBase):
    """Generic PyTorch CPU wrapper for any causal-LM from HuggingFace.

    Used as the baseline backend for benchmarking against OpenVINO variants.
    Weights are loaded from ``model_path``; on first use they are downloaded
    from ``hub_id`` and saved locally.
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
        n_threads = apply_pytorch_thread_limit()
        self._report(f"PyTorch thread count set to {n_threads}")
        check_ram(_MIN_FREE_RAM_BYTES, f"GenericSLMPyTorch ({self.model_id})")

        local_path = Path(self.model_path)
        if not (local_path / "config.json").exists():
            src = self.hub_id or self.model_path
            self._report(
                f"model not found locally — downloading '{src}' "
                "from HuggingFace (this may take several minutes)"
            )
            local_path.mkdir(parents=True, exist_ok=True)
            tokenizer = AutoTokenizer.from_pretrained(src)
            tokenizer.save_pretrained(str(local_path))
            model = AutoModelForCausalLM.from_pretrained(src)
            model.save_pretrained(str(local_path))
            self._report(f"download complete — saved to '{self.model_path}'")

        self._tokenizer = AutoTokenizer.from_pretrained(str(local_path))
        self._model = AutoModelForCausalLM.from_pretrained(str(local_path))

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
