#!/usr/bin/env python3
"""
Generate the standardized ASR benchmark audio file from the reference transcript.

Uses pyttsx3 (Windows SAPI5 / macOS NSSpeechSynthesizer / Linux espeak) so no
internet connection is required. The output audio is saved as a 16 kHz mono WAV
at data/benchmark/asr_audio.wav.

Run once before the first benchmark:
    python scripts/setup_benchmark_data.py
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

REFERENCE_PATH = Path("data/benchmark/asr_reference.txt")
OUTPUT_PATH = Path("data/benchmark/asr_audio.wav")
TARGET_SR = 16_000


def generate_audio(text: str, output_path: Path) -> None:
    import pyttsx3
    import soundfile as sf
    import numpy as np

    # pyttsx3 can only save to file via a temp path — resample afterwards
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    engine = pyttsx3.init()
    # Slow down slightly for clearer medical term pronunciation
    engine.setProperty("rate", 150)
    engine.setProperty("volume", 1.0)
    engine.save_to_file(text, tmp_path)
    engine.runAndWait()

    # Load and resample to 16 kHz mono (Whisper's expected sample rate)
    audio, sr = sf.read(tmp_path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    if sr != TARGET_SR:
        # Simple linear resampling via numpy (avoids resampy/librosa dependency)
        duration = len(audio) / sr
        n_target = int(duration * TARGET_SR)
        indices = np.linspace(0, len(audio) - 1, n_target)
        lo = np.floor(indices).astype(int)
        hi = np.minimum(lo + 1, len(audio) - 1)
        frac = indices - lo
        audio = audio[lo] * (1 - frac) + audio[hi] * frac

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), audio, TARGET_SR)
    Path(tmp_path).unlink(missing_ok=True)


def main() -> None:
    if not REFERENCE_PATH.exists():
        print(f"ERROR: reference file not found: {REFERENCE_PATH}")
        sys.exit(1)

    text = REFERENCE_PATH.read_text(encoding="utf-8").strip()
    print(f"Reference text: {len(text.split())} words")
    print(f"Generating audio -> {OUTPUT_PATH} ...")

    generate_audio(text, OUTPUT_PATH)

    import soundfile as sf
    audio, sr = sf.read(str(OUTPUT_PATH))
    duration = len(audio) / sr
    print(f"Done. Duration: {duration:.1f}s  Sample rate: {sr} Hz")
    print(f"Saved to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
