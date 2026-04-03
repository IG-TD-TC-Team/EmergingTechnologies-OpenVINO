"""
Test Whisper OpenVINO implementation.

Simple script to verify that the Whisper model loads and transcribes correctly.

USAGE:
    # Test with generated audio (no audio file needed)
    python scripts/test_whisper.py --model models/whisper-medium-ov

    # Test with your own audio file
    python scripts/test_whisper.py --model models/whisper-medium-ov --audio data/samples/test.wav

    # Test with different language
    python scripts/test_whisper.py --model models/whisper-medium-ov --audio data/samples/french.wav --language fr
"""

import argparse
import logging
import time
from pathlib import Path

import numpy as np
import soundfile as sf

# Add parent directory to path to import src modules
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.asr import WhisperOpenVINO

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def generate_test_audio(duration: float = 5.0, sample_rate: int = 16000) -> np.ndarray:
    """
    Generate a simple test audio signal (sine wave).

    WHY: For quick testing without needing real audio files.
    The model won't transcribe anything meaningful, but it tests the pipeline.

    Args:
        duration: Duration in seconds
        sample_rate: Sample rate in Hz

    Returns:
        Audio samples as float32 numpy array
    """
    logger.info("Generating %s seconds of test audio (sine wave)...", duration)
    t = np.linspace(0, duration, int(sample_rate * duration))
    # 440 Hz sine wave (A note)
    audio = 0.3 * np.sin(2 * np.pi * 440 * t)
    return audio.astype(np.float32)


def load_audio(audio_path: str) -> tuple[np.ndarray, int]:
    """
    Load audio from file.

    Supports WAV, FLAC, OGG, MP3 (via soundfile/libsndfile).

    Args:
        audio_path: Path to audio file

    Returns:
        Tuple of (audio_samples, sample_rate)
    """
    logger.info("Loading audio from %s...", audio_path)
    audio, sample_rate = sf.read(audio_path, dtype="float32")

    # Convert stereo to mono if needed
    if len(audio.shape) > 1:
        logger.info("Converting stereo to mono...")
        audio = audio.mean(axis=1)

    logger.info("Loaded %s seconds of audio at %s Hz", len(audio) / sample_rate, sample_rate)
    return audio, sample_rate


def test_whisper(
    model_path: str,
    audio_path: str | None = None,
    language: str = "en",
    device: str = "CPU"
):
    """
    Test Whisper OpenVINO model.

    Args:
        model_path: Path to converted OpenVINO model
        audio_path: Path to audio file (optional, generates test audio if None)
        language: Language code for transcription
        device: OpenVINO device (CPU, GPU, AUTO)
    """
    logger.info("=" * 80)
    logger.info("Testing Whisper OpenVINO")
    logger.info("=" * 80)
    logger.info("Model: %s", model_path)
    logger.info("Device: %s", device)
    logger.info("Language: %s", language if language else "AUTO-DETECT")
    logger.info("=" * 80)

    # Step 1: Load audio
    if audio_path:
        audio, sample_rate = load_audio(audio_path)
    else:
        logger.warning("No audio file provided, generating test audio...")
        audio = generate_test_audio(duration=5.0)
        sample_rate = 16000

    # Step 2: Initialize model
    logger.info("Initializing Whisper model...")
    start_time = time.time()
    asr = WhisperOpenVINO(
        model_path=model_path,
        device=device,
        compile=True
    )
    init_time = time.time() - start_time
    logger.info("Model initialized in %.2f seconds", init_time)

    # Step 3: Transcribe (first inference triggers lazy loading)
    logger.info("Running transcription...")
    start_time = time.time()
    result = asr.transcribe(
        audio=audio,
        sample_rate=sample_rate,
        language=language,
        source_name="test_audio"
    )
    transcribe_time = time.time() - start_time

    # Step 4: Display results
    logger.info("=" * 80)
    logger.info("RESULTS")
    logger.info("=" * 80)
    logger.info("Duration: %.2f seconds", result.duration)
    logger.info("Transcription time: %.2f seconds", transcribe_time)
    logger.info("Real-time factor: %.2fx", transcribe_time / result.duration)
    if result.language == "auto":
        logger.info("Language: AUTO-DETECTED")
    else:
        logger.info("Language: %s", result.language)
    logger.info("Number of segments: %d", len(result.segments))
    logger.info("=" * 80)
    logger.info("FULL TRANSCRIPTION:")
    logger.info("-" * 80)
    logger.info(result.full_text)
    logger.info("-" * 80)
    logger.info("SEGMENTS:")
    for i, segment in enumerate(result.segments, 1):
        logger.info(
            "[%d] [%.2fs - %.2fs]: %s",
            i,
            segment.start,
            segment.end,
            segment.text.strip()
        )
    logger.info("=" * 80)

    # Performance summary
    if transcribe_time < result.duration:
        logger.info("✓ SUCCESS: Real-time performance achieved!")
        logger.info("  (Transcription faster than audio duration)")
    else:
        logger.warning("⚠ SLOW: Transcription slower than real-time")
        logger.warning("  Consider using a smaller model (tiny/base)")

    logger.info("=" * 80)


def main():
    parser = argparse.ArgumentParser(
        description="Test Whisper OpenVINO implementation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Test with generated audio
  python scripts/test_whisper.py --model models/whisper-medium-ov

  # Test with your audio file
  python scripts/test_whisper.py --model models/whisper-medium-ov --audio data/samples/test.wav

  # Test French transcription
  python scripts/test_whisper.py --model models/whisper-medium-ov --audio data/samples/french.wav --language fr
        """
    )

    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Path to converted OpenVINO model directory"
    )

    parser.add_argument(
        "--audio",
        type=str,
        default=None,
        help="Path to audio file (optional, generates test audio if not provided)"
    )

    parser.add_argument(
        "--language",
        type=str,
        default=None,
        help="Language code for transcription (default: None = auto-detect)"
    )

    parser.add_argument(
        "--device",
        type=str,
        default="CPU",
        choices=["CPU", "GPU", "AUTO"],
        help="OpenVINO device (default: CPU)"
    )

    args = parser.parse_args()

    # Validate model path exists
    if not Path(args.model).exists():
        logger.error("Model not found at %s", args.model)
        logger.error("Run this first: python scripts/convert_whisper.py --output %s", args.model)
        sys.exit(1)

    # Validate audio file if provided
    if args.audio and not Path(args.audio).exists():
        logger.error("Audio file not found at %s", args.audio)
        sys.exit(1)

    test_whisper(
        model_path=args.model,
        audio_path=args.audio,
        language=args.language,
        device=args.device
    )


if __name__ == "__main__":
    main()
