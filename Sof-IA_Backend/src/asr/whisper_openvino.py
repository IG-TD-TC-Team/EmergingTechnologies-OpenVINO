"""
WhisperOpenVINO - Whisper ASR using OpenVINO for CPU optimization.

Extends ASRBase (benchmark hierarchy) so the runner can use it via
ModelFactory. Also preserves the transcribe() API used by existing scripts.
"""

from typing import Generator, Iterator, List
import logging
from pathlib import Path

import numpy as np
from optimum.intel.openvino import OVModelForSpeechSeq2Seq
from transformers import AutoProcessor

from src.benchmark.base import StreamingASRBase
from .base import TranscriptionResult, TranscriptionSegment
from .languages import WHISPER_LANGUAGES

logger = logging.getLogger(__name__)


class WhisperOpenVINO(StreamingASRBase):
    """Whisper ASR using Intel OpenVINO INT8 quantized inference on CPU.

    If ``model_path`` does not exist on disk the model is downloaded from
    ``hub_id`` and exported to OpenVINO format via
    ``optimum-intel`` on first use.  Subsequent :meth:`load` calls read
    directly from the saved IR files.

    This is the **optimized** ASR backend benchmarked against
    :class:`~src.asr.whisper_pytorch.WhisperPyTorch`.
    """

    SUPPORTED_LANGUAGES: list[str] = sorted(WHISPER_LANGUAGES)
    """All language codes supported by Whisper, sorted alphabetically."""

    def __init__(
        self,
        model_id: str,
        model_path: str,
        hub_id: str = "openai/whisper-medium",
        channel=None,
    ):
        """Initialize WhisperOpenVINO.

        Args:
            model_id: Registry key from ``config/models.yaml``
                (e.g. ``"whisper_openvino"``).
            model_path: Local directory that contains (or will receive) the
                exported OpenVINO IR model and processor files.
            hub_id: HuggingFace Hub repository ID used as the source for the
                first-time export (e.g. ``"openai/whisper-medium"``).
            channel: Progress channel injected at construction.

        Note:
            ``transcribe()``, ``name``, ``is_available()``, and
            ``get_supported_languages()`` are scripting API helpers.  They are
            not part of the benchmark runner contract (which only calls
            ``load()``, ``run()``, ``unload()``).
        """
        super().__init__(model_id, model_path, channel)
        self._ov_path = Path(model_path)
        self.hub_id = hub_id
        self.device = "CPU"
        self._model = None
        self._processor = None
        logger.info("Initializing WhisperOpenVINO model_path=%s", model_path)

    # ------------------------------------------------------------------
    # ASRBase / BaseModel interface (used by the benchmark runner)
    # ------------------------------------------------------------------

    def load(self) -> None:
        """Load the Whisper processor and OpenVINO IR model into CPU memory.

        If the model is already loaded this is a no-op.  If ``model_path``
        does not exist, the model is exported from ``hub_id`` first.  The
        export step compiles and saves the OpenVINO IR; it is slow on first
        run.  Progress is reported via :meth:`_report`.
        """
        if self._model is not None:
            return
        if not self._ov_path.exists():
            self._report(
                f"model not found locally — downloading & exporting '{self.hub_id}' "
                "to OpenVINO (this may take several minutes)"
            )
            self._ov_path.mkdir(parents=True, exist_ok=True)
            model = OVModelForSpeechSeq2Seq.from_pretrained(
                self.hub_id, export=True, compile=False
            )
            model.save_pretrained(str(self._ov_path))
            processor = AutoProcessor.from_pretrained(self.hub_id)
            processor.save_pretrained(str(self._ov_path))
            self._report(f"export complete — model saved to '{self._ov_path}'")

        self._report(f"loading OpenVINO model from {self._ov_path}")
        self._model = OVModelForSpeechSeq2Seq.from_pretrained(
            str(self._ov_path), device=self.device, compile=True
        )
        self._processor = AutoProcessor.from_pretrained(str(self._ov_path))
        logger.info("WhisperOpenVINO loaded")

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
            logger.info("WhisperOpenVINO unloaded")

    # ------------------------------------------------------------------
    # Transcription API (used by existing scripts)
    # ------------------------------------------------------------------

    @property
    def name(self) -> str:
        """Unique string identifier for this model instance.

        Returns:
            A string of the form ``"whisper-openvino-<dir_name>"``
            derived from ``model_path`` (e.g.
            ``"whisper-openvino-whisper-medium-ov"``).
        """
        return f"whisper-openvino-{self._ov_path.name}"

    def transcribe(
        self,
        audio: np.ndarray,
        sample_rate: int,
        language: str | None = None,
        source_name: str = "Unknown",
        **kwargs,
    ) -> TranscriptionResult:
        """Transcribe a numpy audio array to text using the OpenVINO runtime.

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

    def transcribe_stream(
        self,
        audio_chunks: Iterator[tuple[bytes, int]],
    ) -> Generator[str, None, str]:
        """Yield cumulative partial transcripts chunk by chunk.

        Each chunk is transcribed independently and appended to the running
        transcript.  Whisper works best with full context, so each chunk
        produces a best-effort partial result.

        Args:
            audio_chunks: Iterator of ``(pcm_bytes, sample_rate)`` tuples.
                ``pcm_bytes`` is a raw ``float32`` PCM byte string.

        Yields:
            Cumulative partial transcript after each chunk.

        Returns:
            Final full transcript via ``StopIteration.value``.
        """
        accumulated: list[str] = []
        for pcm_bytes, sample_rate in audio_chunks:
            audio = np.frombuffer(pcm_bytes, dtype=np.float32)
            result = self.transcribe(audio, sample_rate)
            text = result.full_text.strip()
            if text:
                accumulated.append(text)
            yield " ".join(accumulated)
        return " ".join(accumulated)

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