"""
WhisperPyTorch - Baseline Whisper implementation using PyTorch CPU.

Extends ASRBase (benchmark hierarchy) so the runner can use it via
ModelFactory. Also preserves the transcribe() API used by existing scripts.
"""

from typing import List
import logging

import numpy as np
import torch
from transformers import AutoProcessor, WhisperForConditionalGeneration

from src.benchmark.base import ASRBase
from .base import TranscriptionResult, TranscriptionSegment
from .languages import WHISPER_LANGUAGES

logger = logging.getLogger(__name__)


class WhisperPyTorch(ASRBase):
    """Whisper ASR using standard PyTorch CPU inference.

    Accepts ``model_id`` / ``model_path`` matching the :class:`~src.benchmark.base.ASRBase`
    convention so :class:`~src.benchmark.factory.ModelFactory` can instantiate
    it without special-casing.

    ``model_path`` is passed directly to
    ``transformers.AutoProcessor.from_pretrained`` and
    ``transformers.WhisperForConditionalGeneration.from_pretrained``, so it
    accepts either a local directory or a HuggingFace Hub ID
    (e.g. ``"openai/whisper-medium"``).

    This is the **baseline** ASR backend benchmarked against
    :class:`~src.asr.whisper_openvino.WhisperOpenVINO`.
    """

    SUPPORTED_LANGUAGES: list[str] = sorted(WHISPER_LANGUAGES)
    """All language codes supported by Whisper, sorted alphabetically."""

    def __init__(self, model_id: str, model_path: str, channel=None):
        """Initialize WhisperPyTorch.

        Args:
            model_id: Registry key from ``config/models.yaml``
                (e.g. ``"whisper_pytorch"``).
            model_path: Local directory or HuggingFace Hub ID for model weights
                (e.g. ``"openai/whisper-medium"``).  The model size label shown
                in logs is derived from the last path segment.
            channel: Progress channel injected at construction.

        Note:
            ``transcribe()``, ``name``, ``is_available()``, and
            ``get_supported_languages()`` are scripting API helpers.  They are
            not part of the benchmark runner contract (which only calls
            ``load()``, ``run()``, ``unload()``).
        """
        super().__init__(model_id, model_path, channel)
        # Derive model_size from the hub ID (last path segment, strip "whisper-" prefix)
        last = model_path.split("/")[-1]
        self.model_size = last[len("whisper-"):] if last.startswith("whisper-") else last
        self.device = "cpu"
        self._model = None
        self._processor = None

        torch.set_num_threads(torch.get_num_threads())
        logger.info("Initializing WhisperPyTorch model_path=%s (size=%s)", model_path, self.model_size)

    # ------------------------------------------------------------------
    # ASRBase / BaseModel interface (used by the benchmark runner)
    # ------------------------------------------------------------------

    def load(self) -> None:
        """Load the Whisper processor and model weights into CPU memory.

        If the model is already loaded this is a no-op.  The model is loaded in
        ``float32`` precision on CPU.
        """
        if self._model is not None:
            return
        logger.info("Loading Whisper %s (PyTorch CPU)...", self.model_size)
        self._processor = AutoProcessor.from_pretrained(self.model_path)
        self._model = WhisperForConditionalGeneration.from_pretrained(
            self.model_path, torch_dtype=torch.float32
        ).to(self.device)
        logger.info("Whisper %s loaded", self.model_size)

    def run(self, audio_path: str) -> str:
        """Transcribe an audio file — satisfies :meth:`~src.benchmark.base.ASRBase.run`.

        Reads the audio file with ``soundfile``, converts stereo to mono if
        necessary, then delegates to :meth:`transcribe`.

        Args:
            audio_path: Path to a ``.wav`` or ``.mp3`` audio file.

        Returns:
            Full transcription text (all segments joined by spaces).
        """
        import soundfile as sf
        audio, sample_rate = sf.read(audio_path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)  # stereo -> mono
        result = self.transcribe(audio, sample_rate, source_name=audio_path)
        return result.full_text

    def unload(self) -> None:
        """Delete the model and processor and free CPU memory.

        Safe to call even if :meth:`load` has not been called.
        """
        if self._model is not None:
            del self._model
            del self._processor
            self._model = None
            self._processor = None
            logger.info("WhisperPyTorch unloaded")

    # ------------------------------------------------------------------
    # Transcription API (used by existing scripts)
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        """Unique string identifier for this model instance.

        Returns:
            A string of the form ``"whisper-pytorch-<size>"``
            (e.g. ``"whisper-pytorch-medium"``).
        """
        return f"whisper-pytorch-{self.model_size}"

    def transcribe(
        self,
        audio: np.ndarray,
        sample_rate: int,
        language: str | None = None,
        source_name: str = "Unknown",
        **kwargs,
    ) -> TranscriptionResult:
        """Transcribe a numpy audio array to text.

        Automatically calls :meth:`load` if the model is not yet loaded.
        Input audio is normalized to ``float32`` if needed.

        Args:
            audio: Audio samples as a 1-D numpy array (``float32`` or
                ``int16``).
            sample_rate: Sample rate of ``audio`` in Hz (e.g. ``16000``).
            language: ISO 639-1 language code to force
                (e.g. ``"en"``, ``"fr"``).  ``None`` enables Whisper's
                automatic language detection.
            source_name: Label attached to the returned
                :class:`~src.asr.base.TranscriptionResult` for traceability.
            **kwargs: Ignored; accepted for interface compatibility.

        Returns:
            A :class:`~src.asr.base.TranscriptionResult` containing a single
            segment that spans the full audio duration.
        """
        if self._model is None:
            self.load()

        if audio.dtype == np.int16:
            audio = audio.astype(np.float32) / 32768.0
        elif audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        inputs = self._processor(audio, sampling_rate=sample_rate, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        gen_kwargs = {"task": "transcribe"}
        if language is not None:
            gen_kwargs["language"] = language
        predicted_ids = self._model.generate(**inputs, **gen_kwargs)
        text = self._processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

        duration = len(audio) / sample_rate
        detected_language = language if language is not None else "auto"
        return TranscriptionResult(
            segments=[TranscriptionSegment(text=text, start=0.0, end=duration,
                                           language=detected_language, confidence=1.0)],
            source_name=source_name,
            language=detected_language,
            duration=duration,
        )

    def is_available(self) -> bool:
        """Return ``True`` if the model is currently loaded in memory.

        Returns:
            ``True`` after a successful :meth:`load`, ``False`` otherwise or
            after :meth:`unload`.
        """
        return self._model is not None

    def get_supported_languages(self) -> List[str]:
        """Return a copy of the supported language code list.

        Returns:
            Sorted list of ISO 639-1 language codes supported by Whisper
            (e.g. ``["af", "ar", ..., "zh"]``).
        """
        return self.SUPPORTED_LANGUAGES.copy()
