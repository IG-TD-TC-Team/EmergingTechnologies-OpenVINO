import logging
import threading
from pathlib import Path
from typing import Generator

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer

from src.benchmark.base import StreamingSLMBase
from src.benchmark.resources import apply_pytorch_thread_limit, check_ram

logger = logging.getLogger(__name__)

# BF16 weights: 8B × 2 bytes ≈ 16 GB.  low_cpu_mem_usage=True avoids the
# intermediate FP32 copy so peak stays near 16 GB.  Require 17 GB free.
_MIN_FREE_RAM_BYTES = 17 * 1024 ** 3


def _patch_nncf_logger() -> None:
    """Work around NNCFLogger.warning_once incompatibility with transformers.

    transformers>=4.50 calls ``logger.warning_once(msg, arg)`` with a format
    argument when the optional ``xielu`` CUDA extension is absent.  NNCF
    replaces the transformers logger with ``NNCFLogger`` whose ``warning_once``
    only accepts ``(self, msg)`` — the extra arg raises TypeError.  This patch
    makes ``warning_once`` accept and interpolate variadic args.
    """
    try:
        from nncf.common.logging.logger import NNCFLogger
        _orig = NNCFLogger.warning_once

        def _warning_once_compat(self, msg, *args, **kwargs):
            if args:
                try:
                    msg = msg % args
                except Exception:
                    msg = " ".join([str(msg)] + [str(a) for a in args])
            _orig(self, msg)

        NNCFLogger.warning_once = _warning_once_compat
    except Exception:
        pass


class ApertusPyTorch(StreamingSLMBase):
    """Apertus 8B Instruct running on PyTorch CPU (BF16 baseline).

    Weights are loaded from ``model_path``.  If the path does not exist the
    model is downloaded from HuggingFace Hub (``hub_id``) and saved locally
    on first use.  Subsequent runs load directly from disk.

    This is the **baseline** backend used to compare against
    :class:`~src.slm.apertus_openvino.ApertusOpenVINO`.

    Note: peak RSS for a BF16 8B model on CPU is ~16 GB.  Ensure at least
    24 GB free before loading.
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

    def load(self) -> None:
        """Load tokenizer and BF16 model weights into CPU memory.

        Downloads from ``hub_id`` on first use and saves locally.
        Requires ~16 GB free RAM.  This is the slow, unoptimised baseline.

        Thread count is capped to ``cpu_count - 2`` to leave headroom for the
        OS display driver and avoid a Windows TDR crash under full CPU load.
        """
        n_threads = apply_pytorch_thread_limit()
        self._report(f"PyTorch thread count set to {n_threads} (2 cores reserved for OS)")

        check_ram(_MIN_FREE_RAM_BYTES, "ApertusPyTorch (BF16 8B)")

        local_path = Path(self.model_path)
        _patch_nncf_logger()
        if not (local_path / "config.json").exists():
            self._report(
                f"model not found locally — downloading '{self.hub_id}' "
                "from HuggingFace (this may take several minutes)"
            )
            local_path.mkdir(parents=True, exist_ok=True)
            tokenizer = AutoTokenizer.from_pretrained(self.hub_id)
            tokenizer.save_pretrained(str(local_path))
            model = AutoModelForCausalLM.from_pretrained(
                self.hub_id,
                torch_dtype=torch.bfloat16,
                low_cpu_mem_usage=True,
            )
            model.save_pretrained(str(local_path))
            self._report(f"download complete — model saved to '{self.model_path}'")
        self._tokenizer = AutoTokenizer.from_pretrained(self.model_path)
        self._model = AutoModelForCausalLM.from_pretrained(
            self.model_path,
            torch_dtype=torch.bfloat16,
            low_cpu_mem_usage=True,
        )

    def run(self, prompt: str) -> tuple[str, int]:
        """Run one greedy-decoding inference pass."""
        inputs = self._tokenizer(prompt, return_tensors="pt")
        n_input_tokens = inputs["input_ids"].shape[-1]
        outputs = self._model.generate(
            **inputs, max_new_tokens=self.max_new_tokens, do_sample=False,
            repetition_penalty=1.1,
            eos_token_id=self._tokenizer.eos_token_id,   # stop at <|assistant_end|>
            pad_token_id=self._tokenizer.eos_token_id,
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
            "eos_token_id": self._tokenizer.eos_token_id,   # stop at <|assistant_end|>
            "pad_token_id": self._tokenizer.eos_token_id,
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