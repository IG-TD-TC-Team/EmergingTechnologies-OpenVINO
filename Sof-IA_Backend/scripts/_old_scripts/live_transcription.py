"""
Live audio transcription with Whisper OpenVINO.

Captures audio from microphone in real-time and transcribes it continuously.
Displays transcription, timing, and performance metrics in the terminal.

USAGE:
    python scripts/live_transcription.py --model models/whisper-tiny-ov --language en

CONTROLS:
    Press Ctrl+C to stop
"""

import argparse
import logging
import queue
import sys
import time
from pathlib import Path
from collections import deque

import numpy as np
import sounddevice as sd

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.asr import WhisperOpenVINO

logging.basicConfig(
    level=logging.WARNING,  # Suppress info logs for cleaner output
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class LiveTranscriber:
    """
    Real-time audio transcription system.

    ARCHITECTURE:
    1. Audio capture thread (sounddevice callback)
    2. Audio buffer (queue for thread-safe communication)
    3. VAD-like segmentation (pause detection)
    4. Whisper transcription
    5. Terminal display with metrics

    WHY THIS APPROACH:
    - Whisper processes 30s chunks optimally
    - We accumulate audio until pause detected
    - Then transcribe the segment
    - Display results immediately
    """

    def __init__(
        self,
        model_path: str,
        language: str | None = None,
        sample_rate: int = 16000,
        chunk_duration: float = 0.5,
        pause_threshold: float = 1.0,
        energy_threshold: float = 0.02
    ):
        """
        Initialize live transcriber.

        Args:
            model_path: Path to OpenVINO model
            language: Language code
            sample_rate: Audio sample rate (16000 Hz for Whisper)
            chunk_duration: Audio chunk size in seconds (0.5s = 500ms latency)
            pause_threshold: Seconds of silence to trigger transcription
            energy_threshold: Audio energy below this = silence
        """
        self.model_path = model_path
        self.language = language
        self.sample_rate = sample_rate
        self.chunk_duration = chunk_duration
        self.pause_threshold = pause_threshold
        self.energy_threshold = energy_threshold

        # Audio buffer (thread-safe queue)
        self.audio_queue = queue.Queue()

        # Accumulated audio for current segment
        self.audio_buffer = []

        # Silence detection
        self.silence_duration = 0.0

        # Statistics
        self.total_audio_duration = 0.0
        self.total_transcription_time = 0.0
        self.segment_count = 0

        # ASR model (lazy loaded)
        self.asr = None

        print("=" * 80)
        print("🎤 LIVE TRANSCRIPTION - Whisper OpenVINO")
        print("=" * 80)
        print(f"Model: {model_path}")
        print(f"Language: {language if language else 'AUTO-DETECT'}")
        print(f"Sample rate: {sample_rate} Hz")
        print(f"Chunk size: {chunk_duration}s")
        print(f"Pause threshold: {pause_threshold}s")
        print("=" * 80)
        print("Loading model... (this may take a few seconds)")

        # Load model
        start_time = time.time()
        self.asr = WhisperOpenVINO(
            model_path=model_path,
            device="CPU",
            compile=True
        )
        # Trigger lazy loading with dummy audio
        dummy_audio = np.zeros(int(sample_rate * 1.0), dtype=np.float32)
        self.asr.transcribe(dummy_audio, sample_rate, language=language)
        load_time = time.time() - start_time

        print(f"✓ Model loaded in {load_time:.2f}s")
        print("=" * 80)
        print("🎙️  Speak now! (Press Ctrl+C to stop)")
        print("=" * 80)
        print()

    def audio_callback(self, indata, frames, time_info, status):
        """
        Audio capture callback (called by sounddevice in separate thread).

        WHY CALLBACK:
        - Non-blocking audio capture
        - Runs in real-time audio thread
        - Must be fast and thread-safe

        Args:
            indata: Audio samples (shape: [frames, channels])
            frames: Number of frames
            time_info: Timing information
            status: Stream status
        """
        if status:
            logger.warning("Audio status: %s", status)

        # Convert to mono if needed
        if indata.shape[1] > 1:
            audio = indata.mean(axis=1)
        else:
            audio = indata[:, 0]

        # Put in queue for main thread
        self.audio_queue.put(audio.copy())

    def detect_speech(self, audio: np.ndarray) -> bool:
        """
        Simple energy-based speech detection.

        WHY SIMPLE:
        - Fast (no ML model overhead)
        - Good enough for pause detection
        - For production, use proper VAD (WebRTC VAD, Silero VAD)

        Args:
            audio: Audio chunk

        Returns:
            True if speech detected, False if silence
        """
        energy = np.abs(audio).mean()
        return energy > self.energy_threshold

    def process_audio_chunk(self, audio_chunk: np.ndarray):
        """
        Process a single audio chunk.

        Accumulates audio and triggers transcription on pauses.

        Args:
            audio_chunk: Audio samples from microphone
        """
        # Add to buffer
        self.audio_buffer.append(audio_chunk)

        # Check if speech or silence
        is_speech = self.detect_speech(audio_chunk)

        if is_speech:
            # Speech detected, reset silence counter
            self.silence_duration = 0.0
        else:
            # Silence detected, increment counter
            self.silence_duration += self.chunk_duration

        # If we have audio AND enough silence, transcribe
        if len(self.audio_buffer) > 0 and self.silence_duration >= self.pause_threshold:
            # Only transcribe if we had actual speech
            # (silence_duration >= pause_threshold means we just had speech before)
            if len(self.audio_buffer) > int(self.pause_threshold / self.chunk_duration):
                self.transcribe_buffer()

            # Reset buffer and silence counter
            self.audio_buffer = []
            self.silence_duration = 0.0

        # Also transcribe if buffer gets too long (30s max for Whisper)
        buffer_duration = len(self.audio_buffer) * self.chunk_duration
        if buffer_duration >= 30.0:
            self.transcribe_buffer()
            self.audio_buffer = []
            self.silence_duration = 0.0

    def transcribe_buffer(self):
        """
        Transcribe accumulated audio buffer.

        Displays results with timing metrics.
        """
        if len(self.audio_buffer) == 0:
            return

        # Concatenate audio chunks
        audio = np.concatenate(self.audio_buffer)
        duration = len(audio) / self.sample_rate

        # Skip very short segments
        if duration < 0.5:
            return

        # Transcribe
        start_time = time.time()
        result = self.asr.transcribe(
            audio=audio,
            sample_rate=self.sample_rate,
            language=self.language,
            source_name="microphone"
        )
        transcription_time = time.time() - start_time

        # Update statistics
        self.total_audio_duration += duration
        self.total_transcription_time += transcription_time
        self.segment_count += 1

        # Calculate metrics
        rtf = transcription_time / duration  # Real-Time Factor
        avg_rtf = self.total_transcription_time / self.total_audio_duration

        # Display results
        text = result.full_text.strip()
        if text:  # Only display non-empty transcriptions
            print(f"[Segment #{self.segment_count}]")
            print(f"📝 {text}")
            print(f"⏱️  Duration: {duration:.2f}s | Processing: {transcription_time:.2f}s | RTF: {rtf:.2f}x")
            if avg_rtf < 1.0:
                print(f"✓ Average RTF: {avg_rtf:.2f}x (Real-time capable!)")
            else:
                print(f"⚠ Average RTF: {avg_rtf:.2f}x (Slower than real-time)")
            print("-" * 80)
            print()

    def run(self):
        """
        Main loop - capture and process audio.

        FLOW:
        1. Start audio stream (calls audio_callback in background)
        2. Pop chunks from queue
        3. Process each chunk (accumulate + detect pauses)
        4. Transcribe on pauses
        5. Display results
        """
        try:
            # Start audio stream
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=1,  # Mono
                callback=self.audio_callback,
                blocksize=int(self.sample_rate * self.chunk_duration),
                dtype=np.float32
            ):
                # Process audio chunks from queue
                while True:
                    try:
                        # Get audio chunk (timeout to allow Ctrl+C)
                        audio_chunk = self.audio_queue.get(timeout=0.1)
                        self.process_audio_chunk(audio_chunk)
                    except queue.Empty:
                        continue

        except KeyboardInterrupt:
            print()
            print("=" * 80)
            print("🛑 Stopping...")
            print("=" * 80)

            # Transcribe any remaining audio
            if len(self.audio_buffer) > 0:
                print("Processing remaining audio...")
                self.transcribe_buffer()

            # Display final statistics
            print()
            print("📊 FINAL STATISTICS")
            print("=" * 80)
            print(f"Total segments: {self.segment_count}")
            print(f"Total audio: {self.total_audio_duration:.2f}s")
            print(f"Total processing: {self.total_transcription_time:.2f}s")
            if self.total_audio_duration > 0:
                avg_rtf = self.total_transcription_time / self.total_audio_duration
                print(f"Average RTF: {avg_rtf:.2f}x")
                if avg_rtf < 1.0:
                    speedup = 1.0 / avg_rtf
                    print(f"✓ {speedup:.1f}x faster than real-time!")
                else:
                    print(f"⚠ {avg_rtf:.2f}x slower than real-time")
            print("=" * 80)


def main():
    parser = argparse.ArgumentParser(
        description="Live audio transcription with Whisper OpenVINO",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic usage (English)
  python scripts/live_transcription.py --model models/whisper-tiny-ov

  # French transcription
  python scripts/live_transcription.py --model models/whisper-tiny-ov --language fr

  # Faster response (shorter pauses)
  python scripts/live_transcription.py --model models/whisper-tiny-ov --pause 0.5

  # More sensitive (picks up quieter speech)
  python scripts/live_transcription.py --model models/whisper-tiny-ov --threshold 0.01

Tips:
  - Use 'tiny' or 'base' models for faster real-time performance
  - Speak clearly with pauses between sentences
  - Reduce --pause for faster response (but may cut off sentences)
  - Adjust --threshold if it's too sensitive or not picking up speech
        """
    )

    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Path to converted OpenVINO model directory"
    )

    parser.add_argument(
        "--language",
        type=str,
        default=None,
        help="Language code for transcription (default: None = auto-detect)"
    )

    parser.add_argument(
        "--pause",
        type=float,
        default=1.0,
        help="Pause duration (seconds) to trigger transcription (default: 1.0)"
    )

    parser.add_argument(
        "--threshold",
        type=float,
        default=0.02,
        help="Audio energy threshold for speech detection (default: 0.02)"
    )

    parser.add_argument(
        "--chunk",
        type=float,
        default=0.5,
        help="Audio chunk duration in seconds (default: 0.5)"
    )

    args = parser.parse_args()

    # Validate model path
    if not Path(args.model).exists():
        print(f"❌ Error: Model not found at {args.model}")
        print(f"Run this first: python scripts/convert_whisper.py --output {args.model}")
        sys.exit(1)

    # Create and run transcriber
    transcriber = LiveTranscriber(
        model_path=args.model,
        language=args.language,
        pause_threshold=args.pause,
        energy_threshold=args.threshold,
        chunk_duration=args.chunk
    )

    transcriber.run()


if __name__ == "__main__":
    main()
