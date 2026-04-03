"""
Base classes for ASR (Automatic Speech Recognition) models.

Defines abstract interfaces and data models for transcription.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional
import numpy as np


@dataclass
class TranscriptionSegment:
    """
    A single segment of transcribed audio.

    Similar to a sentence or phrase in the transcription.
    WHY DATACLASS: Automatic __init__, __repr__, __eq__ generation
    (like Kotlin data class or Java record)
    """
    text: str
    start: float  # seconds
    end: float    # seconds
    language: str
    confidence: float = 1.0  # 0.0-1.0, some models don't provide this


@dataclass
class TranscriptionResult:
    """
    Complete transcription result for an audio input.

    Contains all segments plus metadata.
    """
    segments: List[TranscriptionSegment]
    source_name: str
    language: str
    duration: float  # seconds

    @property
    def full_text(self) -> str:
        """Concatenate all segment texts."""
        return " ".join(seg.text.strip() for seg in self.segments)


class ASRModel(ABC):
    """
    Abstract base class for ASR models.

    DESIGN PATTERN: Strategy Pattern
    - Different ASR implementations (Whisper PyTorch, Whisper OpenVINO)
    - All share same interface
    - Easily swappable in pipeline

    Similar to Java interface or C# abstract class.

    REQUIRED METHODS (must be implemented):
    - load() - Load model into memory (one-line core logic)
    - unload() - Free model from memory
    - name - Property returning model identifier string
    - _run() - Core transcription logic (simplified, one-line)
    - transcribe() - Full transcription with metadata
    - is_available() - Check if model is loaded
    - get_supported_languages() - Return supported languages
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """
        Model name identifier.

        Returns:
            String identifier (e.g. "whisper-openvino-tiny")
        """
        pass

    @abstractmethod
    def load(self):
        """
        Load model into memory.

        IMPLEMENTATION REQUIREMENT:
        Must contain ONE LINE core logic to load the model.

        Example (PyTorch):
            self._model = whisper.load_model("medium", device="cpu")

        Example (OpenVINO):
            self._model = OVModelForSpeechSeq2Seq.from_pretrained(model_path)
            self._processor = AutoProcessor.from_pretrained(model_path)
        """
        pass

    @abstractmethod
    def unload(self):
        """
        Unload model and free memory.

        Should set self._model = None and delete references.
        """
        pass

    def _run(self, audio: np.ndarray, sample_rate: int, language: str | None = None) -> str:
        """
        Core transcription logic - simplified version.

        IMPLEMENTATION REQUIREMENT:
        Must contain ONE LINE core logic for transcription.

        Example (PyTorch):
            return self._model.transcribe(audio_path, language=language)["text"]

        Example (OpenVINO):
            inputs = self._processor(audio, sampling_rate=16000, return_tensors="pt")
            predicted_ids = self._model.generate(**inputs)
            return self._processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]

        Args:
            audio: Audio samples (float32 normalized)
            sample_rate: Sample rate in Hz
            language: Language code (None = auto-detect)

        Returns:
            Transcribed text string
        """
        raise NotImplementedError("Subclasses must implement _run()")

    @abstractmethod
    def transcribe(
        self,
        audio: np.ndarray,
        sample_rate: int,
        language: str | None = None,
        source_name: str = "Unknown",
        **kwargs
    ) -> TranscriptionResult:
        """
        Transcribe audio to text.

        Args:
            audio: Audio samples as numpy array (float32 or int16)
            sample_rate: Sample rate in Hz (e.g. 16000)
            language: ISO 639-1 language code (e.g. "en", "fr"), or None for auto-detection
            source_name: Name/label for this audio source
            **kwargs: Model-specific parameters

        Returns:
            TranscriptionResult with segments and metadata
        """
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Check if model is loaded and ready."""
        pass

    @abstractmethod
    def get_supported_languages(self) -> List[str]:
        """Return list of supported language codes."""
        pass
