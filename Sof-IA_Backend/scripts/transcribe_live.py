"""
Transcription audio en temps réel depuis le microphone.

USAGE:
    # OpenVINO (rapide)
    python scripts/transcribe_live.py --backend openvino --model models/whisper-tiny-ov

    # PyTorch (lent, non recommandé pour live)
    python scripts/transcribe_live.py --backend pytorch --model tiny

    # Avec langue forcée
    python scripts/transcribe_live.py --backend openvino --model models/whisper-tiny-ov --language fr

CONTRÔLES:
    Ctrl+C pour arrêter
"""

import argparse
import logging
import queue
import sys
import time
from pathlib import Path

import numpy as np
import sounddevice as sd

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.asr import WhisperOpenVINO, WhisperPyTorch

logging.basicConfig(level=logging.WARNING, format="%(message)s")
logger = logging.getLogger(__name__)


class LiveTranscriber:
    """Transcription temps réel avec détection de pauses."""

    def __init__(self, asr, language, sample_rate=16000, pause_threshold=1.0):
        self.asr = asr
        self.language = language
        self.sample_rate = sample_rate
        self.pause_threshold = pause_threshold

        self.audio_queue = queue.Queue()
        self.buffer = []
        self.silence_duration = 0.0
        self.segment_count = 0

    def audio_callback(self, indata, frames, time_info, status):
        """Callback pour capturer l'audio."""
        audio = indata[:, 0] if indata.shape[1] > 1 else indata[:, 0]
        self.audio_queue.put(audio.copy())

    def is_speech(self, audio):
        """Détection simple de parole par énergie."""
        return np.abs(audio).mean() > 0.02

    def transcribe_buffer(self):
        """Transcrit le buffer accumulé."""
        if not self.buffer:
            return

        audio = np.concatenate(self.buffer)
        duration = len(audio) / self.sample_rate

        if duration < 0.5:
            return

        start = time.time()
        result = self.asr.transcribe(audio, self.sample_rate, language=self.language)
        elapsed = time.time() - start

        text = result.full_text.strip()
        if text:
            self.segment_count += 1
            print(f"\n[Segment #{self.segment_count}]")
            print(f"📝 {text}")
            print(f"⏱️  {duration:.2f}s audio | {elapsed:.2f}s traitement | RTF: {elapsed/duration:.2f}x")
            print("-" * 80)

    def run(self):
        """Boucle principale."""
        print("=" * 80)
        print("🎤 TRANSCRIPTION LIVE")
        print("=" * 80)
        print("Parlez maintenant... (Ctrl+C pour arrêter)")
        print("=" * 80)
        print()

        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=1,
                callback=self.audio_callback,
                blocksize=int(self.sample_rate * 0.5),
                dtype=np.float32
            ):
                while True:
                    try:
                        chunk = self.audio_queue.get(timeout=0.1)
                        self.buffer.append(chunk)

                        if self.is_speech(chunk):
                            self.silence_duration = 0.0
                        else:
                            self.silence_duration += 0.5

                        # Transcrit après une pause
                        if self.silence_duration >= self.pause_threshold and len(self.buffer) > 2:
                            self.transcribe_buffer()
                            self.buffer = []
                            self.silence_duration = 0.0

                        # Limite 30s max
                        if len(self.buffer) * 0.5 >= 30.0:
                            self.transcribe_buffer()
                            self.buffer = []
                            self.silence_duration = 0.0

                    except queue.Empty:
                        continue

        except KeyboardInterrupt:
            print("\n" + "=" * 80)
            print("🛑 Arrêt...")
            print("=" * 80)
            if self.buffer:
                self.transcribe_buffer()
            print(f"Total segments: {self.segment_count}")
            print("=" * 80)


def main():
    parser = argparse.ArgumentParser(description="Transcription live")

    parser.add_argument("--backend", type=str, required=True, choices=["openvino", "pytorch"], help="Backend")
    parser.add_argument("--model", type=str, required=True, help="Modèle (chemin OpenVINO ou taille PyTorch)")
    parser.add_argument("--language", type=str, default=None, help="Code langue (None = auto-detect)")
    parser.add_argument("--pause", type=float, default=1.0, help="Seuil pause en secondes (default: 1.0)")

    args = parser.parse_args()

    # Initialisation
    print(f"🔧 Chargement du modèle ({args.backend})...")
    if args.backend == "openvino":
        if not Path(args.model).exists():
            print(f"❌ Modèle OpenVINO introuvable : {args.model}")
            sys.exit(1)
        asr = WhisperOpenVINO(model_path=args.model, device="CPU", compile=True)
    else:
        asr = WhisperPyTorch(model_size=args.model, device="cpu")

    # Warmup
    print("🔥 Warmup...")
    dummy = np.zeros(16000, dtype=np.float32)
    asr.transcribe(dummy, 16000, language=args.language)
    print("✓ Prêt !\n")

    # Lancement
    transcriber = LiveTranscriber(asr, args.language, pause_threshold=args.pause)
    transcriber.run()


if __name__ == "__main__":
    main()
