"""
Transcription d'un fichier audio local avec Whisper.

USAGE:
    # OpenVINO (rapide)
    python scripts/transcribe_local.py --audio test.wav --backend openvino --model models/whisper-tiny-ov

    # PyTorch (baseline)
    python scripts/transcribe_local.py --audio test.wav --backend pytorch --model tiny

    # Avec langue forcée
    python scripts/transcribe_local.py --audio french.wav --backend openvino --model models/whisper-tiny-ov --language fr
"""

import argparse
import logging
import sys
import time
from pathlib import Path

import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.asr import WhisperOpenVINO, WhisperPyTorch

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def load_audio(audio_path: str):
    """Charge un fichier audio et retourne (audio, sample_rate)."""
    logger.info("📁 Chargement de %s...", audio_path)
    audio, sample_rate = sf.read(audio_path, dtype="float32")

    # Stéréo → Mono
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    duration = len(audio) / sample_rate
    logger.info("✓ Audio chargé : %.2fs @ %d Hz\n", duration, sample_rate)
    return audio, sample_rate


def main():
    parser = argparse.ArgumentParser(description="Transcription audio local")

    parser.add_argument("--audio", type=str, required=True, help="Chemin du fichier audio")
    parser.add_argument("--backend", type=str, required=True, choices=["openvino", "pytorch"], help="Backend")
    parser.add_argument("--model", type=str, required=True, help="Modèle (chemin OpenVINO ou taille PyTorch)")
    parser.add_argument("--language", type=str, default=None, help="Code langue (None = auto-detect)")

    args = parser.parse_args()

    # Validation
    if not Path(args.audio).exists():
        logger.error("❌ Fichier audio introuvable : %s", args.audio)
        sys.exit(1)

    # Chargement audio
    audio, sample_rate = load_audio(args.audio)

    # Initialisation modèle
    logger.info("🔧 Initialisation du modèle (%s)...", args.backend)
    if args.backend == "openvino":
        if not Path(args.model).exists():
            logger.error("❌ Modèle OpenVINO introuvable : %s", args.model)
            sys.exit(1)
        asr = WhisperOpenVINO(model_path=args.model, device="CPU", compile=True)
    else:
        asr = WhisperPyTorch(model_size=args.model, device="cpu")

    # Transcription
    logger.info("🎙️  Transcription en cours...\n")
    start = time.time()
    result = asr.transcribe(audio, sample_rate, language=args.language, source_name=Path(args.audio).name)
    elapsed = time.time() - start

    # Résultats
    rtf = elapsed / result.duration
    print("=" * 80)
    print("📝 TRANSCRIPTION")
    print("=" * 80)
    print(result.full_text)
    print("=" * 80)
    print(f"Langue: {result.language}")
    print(f"Durée audio: {result.duration:.2f}s")
    print(f"Temps traitement: {elapsed:.2f}s")
    print(f"RTF: {rtf:.2f}x", "✅" if rtf < 1.0 else "⚠️")
    print("=" * 80)


if __name__ == "__main__":
    main()
