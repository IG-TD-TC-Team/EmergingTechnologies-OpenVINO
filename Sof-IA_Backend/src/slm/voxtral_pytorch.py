"""Voxtral Mini 4B Realtime — PyTorch CPU baseline (BF16).

Loads ``mistralai/Voxtral-Mini-4B-Realtime-2602`` with full BF16 weights
on CPU and runs end-to-end audio→text generation using the native
``VoxtralRealtimeForConditionalGeneration.generate()`` pipeline.

Requires ``transformers>=5.2.0`` which ships the ``voxtral_realtime`` module
(``VoxtralRealtimeForConditionalGeneration``, ``VoxtralRealtimeProcessor``).

This is the **baseline** backend compared against
:class:`~src.slm.voxtral_openvino.VoxtralOpenVINO`.
"""
import logging
import threading
from pathlib import Path
from typing import Generator

import torch

from src.benchmark.base import AudioSLMBase
from src.benchmark.resources import apply_pytorch_thread_limit, check_ram, patch_nncf_compat

logger = logging.getLogger(__name__)

# BF16 weights: 4B × 2 bytes ≈ 8 GB.  Add headroom for KV cache.
_MIN_FREE_RAM_BYTES = 12 * 1024 ** 3


class VoxtralPyTorch(AudioSLMBase):
    """Voxtral Mini 4B Realtime — PyTorch CPU (BF16) baseline.

    Downloads from ``hub_id`` on first use and saves locally.
    Peak RSS is ~10–12 GB (8 GB model weights + KV cache).

    Requires transformers>=5.2.0 for ``VoxtralRealtimeForConditionalGeneration``.
    """

    def __init__(
        self,
        model_id: str,
        model_path: str,
        max_new_tokens: int = 512,
        hub_id: str = "mistralai/Voxtral-Mini-4B-Realtime-2602",
        channel=None,
    ):
        super().__init__(model_id, model_path, max_new_tokens, channel)
        self.hub_id = hub_id
        self._processor = None
        self._model = None

    def load(self) -> None:
        """Load processor and BF16 model weights into CPU memory."""
        patch_nncf_compat()
        n_threads = apply_pytorch_thread_limit()
        self._report(f"PyTorch thread count set to {n_threads} (2 cores reserved for OS)")
        check_ram(_MIN_FREE_RAM_BYTES, "VoxtralPyTorch (BF16 4B)")

        from transformers import (
            VoxtralRealtimeForConditionalGeneration,
            VoxtralRealtimeProcessor,
        )

        local_path = Path(self.model_path)
        has_weights = (local_path / "model.safetensors").exists() or bool(
            list(local_path.glob("model-*-of-*.safetensors"))
        )
        if not has_weights:
            self._report(
                f"model not found locally — downloading '{self.hub_id}' "
                "from HuggingFace (this may take several minutes)"
            )
            local_path.mkdir(parents=True, exist_ok=True)
            proc = VoxtralRealtimeProcessor.from_pretrained(self.hub_id)
            proc.save_pretrained(str(local_path))
            m = VoxtralRealtimeForConditionalGeneration.from_pretrained(
                self.hub_id,
                torch_dtype=torch.bfloat16,
                low_cpu_mem_usage=True,
            )
            m.save_pretrained(str(local_path))
            self._report(f"download complete — model saved to '{self.model_path}'")

        self._processor = VoxtralRealtimeProcessor.from_pretrained(str(local_path))
        self._model = VoxtralRealtimeForConditionalGeneration.from_pretrained(
            str(local_path),
            torch_dtype=torch.bfloat16,
            low_cpu_mem_usage=True,
        )
        self._model.eval()

    def _load_audio(self, audio_path: str) -> "np.ndarray":
        import numpy as np
        import soundfile as sf
        import librosa

        audio, sr = sf.read(audio_path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != 16000:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=16000)
        return audio

    def run(self, audio_path: str, prompt: str = "") -> tuple[str, int]:
        """Run end-to-end audio→text generation.

        ``prompt`` is not used — VoxtralRealtimeProcessor builds the
        transcription request internally from the audio alone.
        """
        audio = self._load_audio(audio_path)
        inputs = self._processor(audio, return_tensors="pt")
        inputs = inputs.to(self._model.dtype)

        n_input = inputs["input_ids"].shape[-1]
        with torch.no_grad():
            output_ids = self._model.generate(
                **inputs,
                max_new_tokens=self.max_new_tokens,
                do_sample=False,
            )
        n_new = output_ids.shape[-1] - n_input
        text = self._processor.tokenizer.decode(
            output_ids[0][n_input:], skip_special_tokens=True
        )
        return text, n_new

    def run_streaming(self, audio_path: str, prompt: str = "") -> Generator[str, None, tuple[str, int]]:
        """Yield tokens one by one via TextIteratorStreamer."""
        from transformers import TextIteratorStreamer

        audio = self._load_audio(audio_path)
        inputs = self._processor(audio, return_tensors="pt")
        inputs = inputs.to(self._model.dtype)

        streamer = TextIteratorStreamer(
            self._processor.tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
        )
        gen_kwargs = {
            **inputs,
            "max_new_tokens": self.max_new_tokens,
            "do_sample": False,
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
        del self._processor
        self._model = None
        self._processor = None
