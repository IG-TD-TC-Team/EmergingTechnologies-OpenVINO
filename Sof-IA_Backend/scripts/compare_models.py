"""
Compare plusieurs modèles Whisper sur une source audio commune.

USAGE:
    # Comparer 2 modèles sur un fichier local
    python scripts/compare_models.py \\
        --models "openvino:models/whisper-tiny-ov" "pytorch:tiny" \\
        --source local \\
        --audio test.wav

    # Comparer 3 modèles sur un dataset
    python scripts/compare_models.py \\
        --models "openvino:models/whisper-tiny-ov" "openvino:models/whisper-base-ov" "pytorch:base" \\
        --source dataset \\
        --dataset librispeech \\
        --samples 5

    # Avec langue forcée
    python scripts/compare_models.py \\
        --models "openvino:models/whisper-tiny-ov" "pytorch:tiny" \\
        --source local \\
        --audio french.wav \\
        --language fr

FORMAT MODÈLES:
    "backend:model_path"
    - OpenVINO: "openvino:models/whisper-tiny-ov"
    - PyTorch: "pytorch:tiny"
"""

import argparse
import logging
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.asr import WhisperOpenVINO, WhisperPyTorch

logging.basicConfig(level=logging.WARNING, format="%(message)s")
logger = logging.getLogger(__name__)


def parse_model_spec(spec):
    """Parse 'backend:model' -> (backend, model_path)."""
    parts = spec.split(":", 1)
    if len(parts) != 2 or parts[0] not in ["openvino", "pytorch"]:
        raise ValueError(f"Format invalide : '{spec}'. Utilisez 'backend:model'")
    return parts[0], parts[1]


def load_model(backend, model_path):
    """Charge un modèle selon le backend."""
    if backend == "openvino":
        if not Path(model_path).exists():
            raise FileNotFoundError(f"Modèle OpenVINO introuvable : {model_path}")
        return WhisperOpenVINO(model_path=model_path, device="CPU", compile=True)
    else:
        return WhisperPyTorch(model_size=model_path, device="cpu")


def load_audio_source(args):
    """Charge l'audio selon la source."""
    if args.source == "local":
        if not args.audio or not Path(args.audio).exists():
            raise FileNotFoundError(f"Fichier audio introuvable : {args.audio}")

        audio, sr = sf.read(args.audio, dtype="float32")
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        return [{
            "audio": audio,
            "sr": sr,
            "ref": None,
            "id": Path(args.audio).name
        }]

    elif args.source == "dataset":
        try:
            from datasets import load_dataset
        except ImportError:
            raise ImportError("Module 'datasets' requis. Installez avec: pip install datasets")

        samples = []
        ds_name = args.dataset
        ds_lang = args.dataset_lang or "en"
        num = args.samples or 3

        if ds_name == "librispeech":
            ds = load_dataset("librispeech_asr", "clean", split="test", streaming=True)
        elif ds_name == "common_voice":
            ds = load_dataset("mozilla-foundation/common_voice_13_0", ds_lang, split="test", streaming=True, trust_remote_code=True)
        elif ds_name == "fleurs":
            ds = load_dataset("google/fleurs", ds_lang, split="test", streaming=True, trust_remote_code=True)
        else:
            raise ValueError(f"Dataset '{ds_name}' non supporté")

        for i, item in enumerate(ds):
            if i >= num:
                break

            if ds_name == "librispeech":
                ref = item["text"]
            elif ds_name == "common_voice":
                ref = item["sentence"]
            else:  # fleurs
                ref = item["transcription"]

            samples.append({
                "audio": item["audio"]["array"].astype(np.float32),
                "sr": item["audio"]["sampling_rate"],
                "ref": ref,
                "id": f"{ds_name}_{i}"
            })

        return samples

    else:
        raise ValueError(f"Source '{args.source}' invalide")


def calculate_wer(ref, hyp):
    """Calcule le Word Error Rate."""
    if not ref:
        return None

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
    parser = argparse.ArgumentParser(
        description="Comparaison de modèles Whisper",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument("--models", nargs="+", required=True, help="Modèles (format: backend:path)")
    parser.add_argument("--source", type=str, required=True, choices=["local", "dataset"], help="Source audio")
    parser.add_argument("--audio", type=str, help="Fichier audio (si source=local)")
    parser.add_argument("--dataset", type=str, choices=["librispeech", "common_voice", "fleurs"], help="Dataset (si source=dataset)")
    parser.add_argument("--dataset-lang", type=str, help="Langue dataset (pour common_voice/fleurs)")
    parser.add_argument("--samples", type=int, default=3, help="Nombre échantillons dataset")
    parser.add_argument("--language", type=str, default=None, help="Langue transcription (None = auto-detect)")

    args = parser.parse_args()

    # Validation
    if args.source == "local" and not args.audio:
        parser.error("--audio requis avec --source local")
    if args.source == "dataset" and not args.dataset:
        parser.error("--dataset requis avec --source dataset")

    # Parse modèles
    model_specs = []
    for spec in args.models:
        try:
            backend, path = parse_model_spec(spec)
            model_specs.append((backend, path))
        except ValueError as e:
            print(f"❌ {e}")
            sys.exit(1)

    print("=" * 80)
    print("🔬 COMPARAISON DE MODÈLES")
    print("=" * 80)
    print(f"Source: {args.source}")
    print(f"Modèles à comparer: {len(model_specs)}")
    for i, (backend, path) in enumerate(model_specs, 1):
        print(f"  {i}. {backend}:{path}")
    print("=" * 80)
    print()

    # Charger audio
    print("📦 Chargement de la source audio...")
    try:
        samples = load_audio_source(args)
        print(f"✓ {len(samples)} échantillon(s) chargé(s)\n")
    except Exception as e:
        print(f"❌ Erreur: {e}")
        sys.exit(1)

    # Charger modèles
    models = []
    for i, (backend, path) in enumerate(model_specs, 1):
        print(f"🔧 Chargement modèle {i}/{len(model_specs)} ({backend})...")
        try:
            model = load_model(backend, path)
            models.append({"name": f"{backend}:{path}", "model": model, "backend": backend})
            print(f"✓ Modèle {i} chargé\n")
        except Exception as e:
            print(f"❌ Erreur: {e}")
            sys.exit(1)

    # Benchmark
    print("🎙️  Démarrage des tests...\n")

    results = {m["name"]: {"times": [], "rtfs": [], "wers": [], "transcriptions": []} for m in models}

    for sample_idx, sample in enumerate(samples, 1):
        audio = sample["audio"]
        sr = sample["sr"]
        ref = sample["ref"]
        sid = sample["id"]
        duration = len(audio) / sr

        print("=" * 80)
        print(f"ÉCHANTILLON {sample_idx}/{len(samples)}: {sid} ({duration:.2f}s)")
        if ref:
            print(f"REF: {ref}")
        print("=" * 80)
        print()

        for model_info in models:
            name = model_info["name"]
            model = model_info["model"]

            print(f"  Testing {name}...")

            start = time.time()
            result = model.transcribe(audio, sr, language=args.language, source_name=sid)
            elapsed = time.time() - start

            hyp = result.full_text.strip()
            rtf = elapsed / duration
            wer = calculate_wer(ref, hyp) if ref else None

            results[name]["times"].append(elapsed)
            results[name]["rtfs"].append(rtf)
            if wer is not None:
                results[name]["wers"].append(wer)
            results[name]["transcriptions"].append(hyp)

            print(f"    HYP: {hyp}")
            print(f"    Time: {elapsed:.2f}s | RTF: {rtf:.2f}x", end="")
            if wer is not None:
                print(f" | WER: {wer:.2f}%")
            else:
                print()
            print()

    # Résumé comparatif
    print("\n" + "=" * 80)
    print("📊 RÉSUMÉ COMPARATIF")
    print("=" * 80)

    for model_info in models:
        name = model_info["name"]
        data = results[name]

        avg_time = sum(data["times"]) / len(data["times"])
        avg_rtf = sum(data["rtfs"]) / len(data["rtfs"])
        avg_wer = sum(data["wers"]) / len(data["wers"]) if data["wers"] else None

        print(f"\n{name}:")
        print(f"  Temps moyen: {avg_time:.2f}s")
        print(f"  RTF moyen: {avg_rtf:.2f}x", "✅" if avg_rtf < 1.0 else "⚠️")
        if avg_wer is not None:
            print(f"  WER moyen: {avg_wer:.2f}%")

    # Comparaison relative
    if len(models) == 2:
        model1, model2 = models[0]["name"], models[1]["name"]
        time1 = sum(results[model1]["times"])
        time2 = sum(results[model2]["times"])
        speedup = time1 / time2 if time2 > 0 else 1.0

        print(f"\n⚡ SPEEDUP: {model1} vs {model2}")
        if speedup > 1.0:
            print(f"  {model2} est {speedup:.2f}x plus rapide")
        else:
            print(f"  {model1} est {1/speedup:.2f}x plus rapide")

    print("=" * 80)


if __name__ == "__main__":
    main()
