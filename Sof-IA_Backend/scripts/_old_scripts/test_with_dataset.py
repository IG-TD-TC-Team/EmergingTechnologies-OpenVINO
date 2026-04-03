"""
Test Whisper avec des datasets publics depuis Hugging Face.

Télécharge automatiquement des échantillons audio depuis des datasets publics
et les transcrit avec Whisper OpenVINO ou PyTorch.

DATASETS SUPPORTÉS:
- LibriSpeech (anglais, propre)
- Mozilla Common Voice (multilingue, voix réelles)
- Google FLEURS (102 langues)

USAGE:
    # LibriSpeech (anglais)
    python scripts/test_with_dataset.py --model models/whisper-tiny-ov --dataset librispeech

    # Common Voice français
    python scripts/test_with_dataset.py --model models/whisper-tiny-ov --dataset common_voice --language fr

    # FLEURS multilingue
    python scripts/test_with_dataset.py --model models/whisper-tiny-ov --dataset fleurs --language fr_fr

    # Plusieurs échantillons
    python scripts/test_with_dataset.py --model models/whisper-tiny-ov --dataset librispeech --samples 5

    # Avec PyTorch (lent)
    python scripts/test_with_dataset.py --model tiny --backend pytorch --dataset librispeech

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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def load_dataset_samples(dataset_name: str, language: str = "en", num_samples: int = 1):
    """
    Charge des échantillons audio depuis Hugging Face datasets.

    Args:
        dataset_name: Nom du dataset (librispeech, common_voice, fleurs)
        language: Code langue
        num_samples: Nombre d'échantillons à charger

    Returns:
        Liste de dictionnaires avec audio, sample_rate, text_reference
    """
    try:
        from datasets import load_dataset
    except ImportError:
        logger.error("❌ Module 'datasets' non installé !")
        logger.error("Installez avec : pip install datasets")
        sys.exit(1)

    logger.info("📦 Téléchargement du dataset '%s' (peut prendre quelques minutes la première fois)...", dataset_name)

    samples = []

    if dataset_name == "librispeech":
        # LibriSpeech - Anglais uniquement
        logger.info("Chargement de LibriSpeech (test-clean)...")
        dataset = load_dataset("librispeech_asr", "clean", split="test", streaming=True)

        for i, item in enumerate(dataset):
            if i >= num_samples:
                break

            samples.append({
                "audio": item["audio"]["array"],
                "sample_rate": item["audio"]["sampling_rate"],
                "text_reference": item["text"],
                "id": item.get("id", f"sample_{i}")
            })

    elif dataset_name == "common_voice":
        # Mozilla Common Voice - Multilingue
        logger.info("Chargement de Common Voice (langue: %s)...", language)
        try:
            dataset = load_dataset(
                "mozilla-foundation/common_voice_13_0",
                language,
                split="test",
                streaming=True,
                trust_remote_code=True
            )

            for i, item in enumerate(dataset):
                if i >= num_samples:
                    break

                samples.append({
                    "audio": item["audio"]["array"],
                    "sample_rate": item["audio"]["sampling_rate"],
                    "text_reference": item["sentence"],
                    "id": f"cv_{language}_{i}"
                })
        except Exception as e:
            logger.error("❌ Erreur lors du chargement de Common Voice: %s", e)
            logger.error("Langues disponibles: en, fr, de, es, it, etc.")
            sys.exit(1)

    elif dataset_name == "fleurs":
        # Google FLEURS - 102 langues
        logger.info("Chargement de FLEURS (langue: %s)...", language)
        try:
            dataset = load_dataset(
                "google/fleurs",
                language,
                split="test",
                streaming=True,
                trust_remote_code=True
            )

            for i, item in enumerate(dataset):
                if i >= num_samples:
                    break

                samples.append({
                    "audio": item["audio"]["array"],
                    "sample_rate": item["audio"]["sampling_rate"],
                    "text_reference": item["transcription"],
                    "id": f"fleurs_{language}_{i}"
                })
        except Exception as e:
            logger.error("❌ Erreur lors du chargement de FLEURS: %s", e)
            logger.error("Format langue: fr_fr, en_us, de_de, etc.")
            sys.exit(1)

    else:
        logger.error("❌ Dataset '%s' non supporté", dataset_name)
        logger.error("Datasets disponibles: librispeech, common_voice, fleurs")
        sys.exit(1)

    logger.info("✓ %d échantillons chargés", len(samples))
    return samples


def calculate_wer(reference: str, hypothesis: str) -> float:
    """
    Calcule le Word Error Rate (WER).

    WER = (Substitutions + Insertions + Deletions) / Nombre de mots de référence

    Args:
        reference: Transcription de référence
        hypothesis: Transcription prédite

    Returns:
        WER en pourcentage (0-100)
    """
    # Normalisation simple
    ref_words = reference.lower().split()
    hyp_words = hypothesis.lower().split()

    # Matrice de distance de Levenshtein (programmation dynamique)
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
                substitution = d[i - 1][j - 1] + 1
                insertion = d[i][j - 1] + 1
                deletion = d[i - 1][j] + 1
                d[i][j] = min(substitution, insertion, deletion)

    distance = d[len(ref_words)][len(hyp_words)]

    if len(ref_words) == 0:
        return 100.0 if len(hyp_words) > 0 else 0.0

    wer = (distance / len(ref_words)) * 100
    return wer


def main():
    parser = argparse.ArgumentParser(
        description="Test Whisper avec datasets Hugging Face",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  # LibriSpeech (anglais)
  python scripts/test_with_dataset.py --model models/whisper-tiny-ov --dataset librispeech

  # Common Voice français
  python scripts/test_with_dataset.py --model models/whisper-tiny-ov --dataset common_voice --language fr

  # FLEURS allemand
  python scripts/test_with_dataset.py --model models/whisper-tiny-ov --dataset fleurs --language de_de

  # Tester 10 échantillons
  python scripts/test_with_dataset.py --model models/whisper-tiny-ov --dataset librispeech --samples 10

Datasets disponibles:
  - librispeech: Anglais uniquement, très propre
  - common_voice: 100+ langues, voix réelles (bruyant)
  - fleurs: 102 langues, qualité moyenne

Langues Common Voice: en, fr, de, es, it, pl, nl, pt, ru, ja, zh, ko, etc.
Langues FLEURS: en_us, fr_fr, de_de, es_419, it_it, ja_jp, etc.
        """
    )

    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Chemin modèle OpenVINO ou taille PyTorch (tiny, base, small, medium)"
    )

    parser.add_argument(
        "--backend",
        type=str,
        default="openvino",
        choices=["openvino", "pytorch"],
        help="Backend (default: openvino)"
    )

    parser.add_argument(
        "--dataset",
        type=str,
        required=True,
        choices=["librispeech", "common_voice", "fleurs"],
        help="Dataset à utiliser"
    )

    parser.add_argument(
        "--language",
        type=str,
        default=None,
        help="Code langue (en, fr, de...) ou None pour auto-detect (default: None)"
    )

    parser.add_argument(
        "--samples",
        type=int,
        default=3,
        help="Nombre d'échantillons à tester (default: 3)"
    )

    args = parser.parse_args()

    # Configuration
    logger.info("=" * 80)
    logger.info("TEST WHISPER AVEC DATASET PUBLIC")
    logger.info("=" * 80)
    logger.info("Backend: %s", args.backend)
    logger.info("Modèle: %s", args.model)
    logger.info("Dataset: %s", args.dataset)
    logger.info("Langue: %s", args.language if args.language else "AUTO-DETECT")
    logger.info("Échantillons: %d", args.samples)
    logger.info("=" * 80)

    # Charger le dataset
    dataset_language = args.language if args.language else "en"
    samples = load_dataset_samples(args.dataset, dataset_language, args.samples)

    if len(samples) == 0:
        logger.error("❌ Aucun échantillon chargé !")
        sys.exit(1)

    # Initialiser le modèle
    logger.info("\n🔧 Initialisation du modèle...")
    if args.backend == "openvino":
        if not Path(args.model).exists():
            logger.error("❌ Modèle OpenVINO introuvable : %s", args.model)
            logger.error("Convertissez d'abord : python scripts/convert_whisper.py --model tiny --output %s", args.model)
            sys.exit(1)
        asr = WhisperOpenVINO(model_path=args.model, device="CPU", compile=True)
    else:
        asr = WhisperPyTorch(model_size=args.model, device="cpu")

    # Tester chaque échantillon
    logger.info("\n🎙️  Démarrage des tests...\n")

    total_wer = 0.0
    total_duration = 0.0
    total_processing_time = 0.0
    results = []

    for i, sample in enumerate(samples, 1):
        audio = sample["audio"]
        sample_rate = sample["sample_rate"]
        text_ref = sample["text_reference"]
        sample_id = sample["id"]

        # Convertir en float32 si nécessaire
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        duration = len(audio) / sample_rate

        logger.info("-" * 80)
        logger.info("ÉCHANTILLON %d/%d - ID: %s", i, len(samples), sample_id)
        logger.info("-" * 80)
        logger.info("Durée audio: %.2fs", duration)

        # Transcription
        start_time = time.time()
        result = asr.transcribe(
            audio=audio,
            sample_rate=sample_rate,
            language=args.language,
            source_name=sample_id
        )
        processing_time = time.time() - start_time

        transcription = result.full_text.strip()

        # Calcul WER
        wer = calculate_wer(text_ref, transcription)

        # Métriques
        rtf = processing_time / duration

        # Affichage
        logger.info("📝 Référence: %s", text_ref)
        logger.info("🤖 Transcription: %s", transcription)
        logger.info("📊 WER: %.2f%%", wer)
        logger.info("⏱️  Temps de traitement: %.2fs (RTF: %.2fx)", processing_time, rtf)

        # Statistiques
        total_wer += wer
        total_duration += duration
        total_processing_time += processing_time

        results.append({
            "id": sample_id,
            "reference": text_ref,
            "transcription": transcription,
            "wer": wer,
            "duration": duration,
            "processing_time": processing_time,
            "rtf": rtf
        })

    # Résumé final
    avg_wer = total_wer / len(samples)
    avg_rtf = total_processing_time / total_duration

    logger.info("\n" + "=" * 80)
    logger.info("📈 RÉSUMÉ")
    logger.info("=" * 80)
    logger.info("Échantillons testés: %d", len(samples))
    logger.info("Durée audio totale: %.2fs", total_duration)
    logger.info("Temps de traitement total: %.2fs", total_processing_time)
    logger.info("WER moyen: %.2f%%", avg_wer)
    logger.info("RTF moyen: %.2fx", avg_rtf)

    if avg_rtf < 1.0:
        speedup = 1.0 / avg_rtf
        logger.info("✓ Capable de traiter en temps réel (%.1fx plus rapide)", speedup)
    else:
        logger.info("⚠ Plus lent que temps réel")

    logger.info("=" * 80)

    # Détails par échantillon
    logger.info("\n📋 DÉTAILS PAR ÉCHANTILLON:")
    logger.info("-" * 80)
    for r in results:
        logger.info("[%s] WER: %.2f%% | RTF: %.2fx | Durée: %.2fs",
                    r["id"], r["wer"], r["rtf"], r["duration"])
    logger.info("=" * 80)


if __name__ == "__main__":
    main()
