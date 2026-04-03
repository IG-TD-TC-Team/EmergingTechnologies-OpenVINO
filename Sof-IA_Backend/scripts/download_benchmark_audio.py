#!/usr/bin/env python3
"""
Download real audio samples with verified transcripts for ASR benchmarking.

Sources (all public domain / open license):
  en  LibriSpeech test-clean   openslr/librispeech_asr
  fr  Multilingual LibriSpeech  facebook/multilingual_librispeech

Usage:
    python scripts/download_benchmark_audio.py               # English, 5 samples
    python scripts/download_benchmark_audio.py --lang fr     # French, 5 samples
    python scripts/download_benchmark_audio.py --lang en --samples 10
"""

import argparse
import io
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

TARGET_SR = 16_000
BASE_DIR = Path("data/benchmark")

LANG_CONFIG = {
    "en": {
        "repo":         "openslr/librispeech_asr",
        "parquet_filter": "test.clean",
        "text_field":   "text",
        "dataset_name": "LibriSpeech test-clean",
        "out_dir":      "librispeech",
        "language":     "en",
    },
    "fr": {
        "repo":         "facebook/multilingual_librispeech",
        "parquet_filter": "french/test",
        "text_field":   "transcript",
        "dataset_name": "MLS French test",
        "out_dir":      "mls_french",
        "language":     "fr",
    },
}


def list_parquets(repo: str, parquet_filter: str) -> list[str]:
    from huggingface_hub import HfApi
    files = list(HfApi().list_repo_files(repo_id=repo, repo_type="dataset"))
    return sorted(f for f in files if parquet_filter in f and f.endswith(".parquet"))


def resample(audio: np.ndarray, sr: int) -> np.ndarray:
    if sr == TARGET_SR:
        return audio
    duration = len(audio) / sr
    n = int(duration * TARGET_SR)
    idx = np.linspace(0, len(audio) - 1, n)
    lo = np.floor(idx).astype(int)
    hi = np.minimum(lo + 1, len(audio) - 1)
    frac = idx - lo
    return audio[lo] * (1 - frac) + audio[hi] * frac


def download(lang: str, n_samples: int) -> None:
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download

    cfg = LANG_CONFIG[lang]
    out_dir = BASE_DIR / cfg["out_dir"]
    manifest_path = out_dir / "manifest.json"

    print(f"Language: {lang.upper()}  dataset: {cfg['dataset_name']}")
    print(f"Listing parquet files in {cfg['repo']} ...")

    parquets = list_parquets(cfg["repo"], cfg["parquet_filter"])
    if not parquets:
        print(f"ERROR: no parquet files found matching '{cfg['parquet_filter']}'")
        sys.exit(1)
    print(f"Found {len(parquets)} parquet file(s).")

    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    count = 0

    for pf in parquets:
        if count >= n_samples:
            break
        print(f"Downloading {pf} ...")
        local = hf_hub_download(repo_id=cfg["repo"], filename=pf, repo_type="dataset")
        rows = pq.read_table(local).to_pylist()

        for row in rows:
            if count >= n_samples:
                break

            audio_bytes = (row.get("audio") or {}).get("bytes")
            text = row.get(cfg["text_field"], "").strip()
            if not audio_bytes or not text:
                continue

            audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            audio = resample(audio, sr)

            fname = f"sample_{count:02d}_{lang}_speaker{row.get('speaker_id', 'unk')}.wav"
            fpath = out_dir / fname
            sf.write(str(fpath), audio, TARGET_SR)

            duration = round(len(audio) / TARGET_SR, 2)
            manifest.append({
                "file": f"data/benchmark/{cfg['out_dir']}/{fname}",
                "reference": text,
                "speaker_id": str(row.get("speaker_id", "")),
                "duration_s": duration,
                "language": lang,
                "dataset": cfg["dataset_name"],
            })
            print(f"  [{count+1}/{n_samples}]  {fname}  {duration:.1f}s")
            print(f"           \"{text[:80]}\"")
            count += 1

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nDone. {len(manifest)} file(s) -> {out_dir}/")
    print(f"Manifest: {manifest_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download ASR benchmark audio samples.")
    parser.add_argument("--lang", choices=list(LANG_CONFIG), default="en",
                        help="Language to download (default: en)")
    parser.add_argument("--samples", type=int, default=5,
                        help="Number of samples (default: 5)")
    args = parser.parse_args()
    download(args.lang, args.samples)


if __name__ == "__main__":
    main()
