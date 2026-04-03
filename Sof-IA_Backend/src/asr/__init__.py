"""
ASR (Automatic Speech Recognition) module.

Provides Whisper-based transcription with OpenVINO optimization
and baseline PyTorch implementation for comparison.
"""

from .base import ASRModel, TranscriptionResult, TranscriptionSegment
from .whisper_openvino import WhisperOpenVINO
from .whisper_pytorch import WhisperPyTorch
from .languages import WHISPER_LANGUAGES

__all__ = [
    "ASRModel",
    "TranscriptionResult",
    "TranscriptionSegment",
    "WhisperOpenVINO",
    "WhisperPyTorch",
    "WHISPER_LANGUAGES",
]
