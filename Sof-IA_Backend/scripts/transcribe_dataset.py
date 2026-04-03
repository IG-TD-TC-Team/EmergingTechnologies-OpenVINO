"""
Transcription d'échantillons depuis des datasets publics Hugging Face.

DATASETS SUPPORTÉS:
    - librispeech: Anglais, propre
    - common_voice: 100+ langues
    - fleurs: 102 langues

USAGE:
    # LibriSpeech avec OpenVINO
    python scripts/transcribe_dataset.py --dataset librispeech --backend openvino --model models/whisper-tiny-ov --samples 5

    # Common Voice français avec PyTorch
    python scripts/transcribe_dataset.py --dataset common_voice --lang fr --backend pytorch --model tiny --samples 3

    # FLEURS allemand
    python scripts/transcribe_dataset.py --dataset fleurs --lang de_de --backend openvino --model models/whisper-tiny-ov

PRÉREQUIS:
    pip install datasets
"""

import argparse
import logging
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.asr import WhisperOpenVINO, WhisperPyTorch

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def load_dataset(name, lang, num_samples):
    """Charge des échantillons depuis Hugging Face."""
    try:
        from datasets import load_dataset as hf_load
    except ImportError:
        logger.error("❌ Module 'datasets' manquant. Installez avec: pip install datasets")
        sys.exit(1)

    logger.info(f"📦 Téléchargement du dataset '{name}'...")

    samples = []

    if name == "librispeech":
        ds = hf_load("librispeech_asr", "clean", split="test", streaming=True)
        for i, item in enumerate(ds):
            if i >= num_samples:
                break
            samples.append({
                "audio": item["audio"]["array"],
                "sr": item["audio"]["sampling_rate"],
                "ref": item["text"],
                "id": item.get("id", f"sample_{i}")
            })

    elif name == "common_voice":
        ds = hf_load("mozilla-foundation/common_voice_13_0", lang, split="test", streaming=True, trust_remote_code=True)
        for i, item in enumerate(ds):
            if i >= num_samples:
                break
            samples.append({
                "audio": item["audio"]["array"],
                "sr": item["audio"]["sampling_rate"],
                "ref": item["sentence"],
                "id": f"cv_{i}"
            })

    elif name == "fleurs":
        ds = hf_load("google/fleurs", lang, split="test", streaming=True, trust_remote_code=True)
        for i, item in enumerate(ds):
            if i >= num_samples:
                break
            samples.append({
                "audio": item["audio"]["array"],
                "sr": item["audio"]["sampling_rate"],
                "ref": item["transcription"],
                "id": f"fleurs_{i}"
            })

    else:
        logger.error(f"❌ Dataset '{name}' non supporté")
        sys.exit(1)

    logger.info(f"✓ {len(samples)} échantillons chargés\n")
    return samples


def calculate_wer(ref, hyp):
    """Calcule le Word Error Rate (WER)."""
    ref_words = ref.lower().split()
    hyp_words = hyp.lower().split()

    d = [[0] * (len(hyp_words) + 1) for _ in range(len(ref_words) + 1)]
    for i in range(len(ref_words) + 1):
        d[i][0] = i
    for j in range(len(hyp_words) + 1):
        d[0][j] = j

    for i in range(1, len(ref_words) + 1):
        for j in range(1, len(hyp_words) + 1):
            if ref_words[i - 1] == hyp_words[j - 1]:
                d[i][j] = d[i - 1][j - 1]
            else:
                d[i][j] = min(d[i - 1][j - 1] + 1, d[i][j - 1] + 1, d[i - 1][j] + 1)

    return (d[len(ref_words)][len(hyp_words)] / len(ref_words) * 100) if ref_words else 0.0


def main():
    parser = argparse.ArgumentParser(description="Transcription dataset")

    parser.add_argument("--dataset", type=str, required=True, choices=["librispeech", "common_voice", "fleurs"], help="Dataset")
    parser.add_argument("--lang", type=str, default="en", help="Code langue (default: en)")
    parser.add_argument("--backend", type=str, required=True, choices=["openvino", "pytorch"], help="Backend")
    parser.add_argument("--model", type=str, required=True, help="Modèle (chemin OpenVINO ou taille PyTorch)")
    parser.add_argument("--samples", type=int, default=3, help="Nombre d'échantillons (default: 3)")
    parser.add_argument("--language", type=str, default=None, help="Langue transcription (None = auto-detect)")

    args = parser.parse_args()

    # Chargement dataset
    samples = load_dataset(args.dataset, args.lang, args.samples)

    # Initialisation modèle
    logger.info(f"🔧 Initialisation du modèle ({args.backend})...")
    if args.backend == "openvino":
        if not Path(args.model).exists():
            logger.error(f"❌ Modèle OpenVINO introuvable : {args.model}")
            sys.exit(1)
        asr = WhisperOpenVINO(model_path=args.model, device="CPU", compile=True)
    else:
        asr = WhisperPyTorch(model_size=args.model, device="cpu")

    logger.info("✓ Modèle chargé\n")

    # Tests
    logger.info("🎙️  Démarrage des tests...\n")

    total_wer = 0.0
    total_duration = 0.0
    total_time = 0.0

    for i, sample in enumerate(samples, 1):
        audio = sample["audio"].astype(np.float32) if sample["audio"].dtype != np.float32 else sample["audio"]
        sr = sample["sr"]
        ref = sample["ref"]
        sid = sample["id"]

        duration = len(audio) / sr

        logger.info(f"[{i}/{len(samples)}] {sid} ({duration:.2f}s)")

        start = time.time()
        result = asr.transcribe(audio, sr, language=args.language, source_name=sid)
        elapsed = time.time() - start

        hyp = result.full_text.strip()
        wer = calculate_wer(ref, hyp)

        logger.info(f"  REF: {ref}")
        logger.info(f"  HYP: {hyp}")
        logger.info(f"  WER: {wer:.2f}% | RTF: {elapsed/duration:.2f}x")
        logger.info("")

        total_wer += wer
        total_duration += duration
        total_time += elapsed

    # Résumé
    avg_wer = total_wer / len(samples)
    avg_rtf = total_time / total_duration

    print("=" * 80)
    print("📊 RÉSUMÉ")
    print("=" * 80)
    print(f"Échantillons: {len(samples)}")
    print(f"WER moyen: {avg_wer:.2f}%")
    print(f"RTF moyen: {avg_rtf:.2f}x", "✅" if avg_rtf < 1.0 else "⚠️")
    print(f"Audio total: {total_duration:.2f}s")
    print(f"Temps total: {total_time:.2f}s")
    print("=" * 80)


if __name__ == "__main__":
    main()
