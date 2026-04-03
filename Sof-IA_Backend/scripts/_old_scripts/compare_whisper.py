"""
Compare Whisper PyTorch (baseline) vs Whisper OpenVINO (optimized).

Side-by-side performance comparison showing OpenVINO's speedup.

USAGE:
    # Compare with generated test audio
    python scripts/compare_whisper.py --model-size tiny

    # Compare with your audio file
    python scripts/compare_whisper.py --model-size tiny --audio data/samples/test.wav

    # Compare medium model (will be very slow on PyTorch!)
    python scripts/compare_whisper.py --model-size medium --audio data/samples/test.wav
"""

import argparse
import logging
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import psutil

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.asr import WhisperOpenVINO
from src.asr.whisper_pytorch import WhisperPyTorch

logging.basicConfig(
    level=logging.WARNING,  # Suppress info logs for cleaner output
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def generate_test_audio(duration: float = 30.0, sample_rate: int = 16000) -> np.ndarray:
    """
    Generate test audio (sine wave).

    Args:
        duration: Duration in seconds
        sample_rate: Sample rate in Hz

    Returns:
        Audio samples as float32
    """
    print(f"📢 Generating {duration}s of test audio...")
    t = np.linspace(0, duration, int(sample_rate * duration))
    # Mix of frequencies to simulate speech-like signal
    audio = (
        0.2 * np.sin(2 * np.pi * 200 * t) +
        0.2 * np.sin(2 * np.pi * 400 * t) +
        0.1 * np.sin(2 * np.pi * 800 * t)
    )
    return audio.astype(np.float32)


def load_audio(audio_path: str) -> tuple[np.ndarray, int]:
    """Load audio from file."""
    print(f"📁 Loading audio from {audio_path}...")
    audio, sample_rate = sf.read(audio_path, dtype="float32")

    # Convert stereo to mono
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    print(f"✓ Loaded {len(audio) / sample_rate:.2f}s at {sample_rate} Hz")
    return audio, sample_rate


def get_memory_usage() -> float:
    """Get current process memory usage in MB."""
    process = psutil.Process()
    return process.memory_info().rss / 1024 / 1024


def benchmark_model(
    model,
    audio: np.ndarray,
    sample_rate: int,
    language: str,
    backend_name: str
) -> dict:
    """
    Benchmark a single model.

    Args:
        model: ASR model instance
        audio: Audio samples
        sample_rate: Sample rate
        language: Language code
        backend_name: Name for display

    Returns:
        Dict with benchmark results
    """
    print(f"\n{'=' * 80}")
    print(f"🧪 Testing: {backend_name}")
    print(f"{'=' * 80}")

    # Memory before
    mem_before = get_memory_usage()

    # Warm-up run (triggers lazy loading)
    print("🔥 Warming up (loading model)...")
    warmup_start = time.time()
    _ = model.transcribe(
        audio=audio[:int(sample_rate * 2)],  # First 2 seconds for warmup
        sample_rate=sample_rate,
        language=language,
        source_name="warmup"
    )
    warmup_time = time.time() - warmup_start
    print(f"✓ Warmup completed in {warmup_time:.2f}s")

    # Memory after loading
    mem_after_load = get_memory_usage()
    mem_model = mem_after_load - mem_before

    # Actual benchmark run
    print("⚡ Running benchmark...")
    start_time = time.time()
    result = model.transcribe(
        audio=audio,
        sample_rate=sample_rate,
        language=language,
        source_name="benchmark"
    )
    inference_time = time.time() - start_time

    # Memory after inference
    mem_after_inference = get_memory_usage()

    # Calculate metrics
    audio_duration = len(audio) / sample_rate
    rtf = inference_time / audio_duration
    speedup = 1.0 / rtf if rtf > 0 else 0.0

    # Display results
    print(f"\n📊 RESULTS")
    print(f"{'-' * 80}")
    print(f"Audio duration:     {audio_duration:.2f}s")
    print(f"Processing time:    {inference_time:.2f}s")
    print(f"Real-Time Factor:   {rtf:.2f}x")
    if rtf < 1.0:
        print(f"Speedup:            {speedup:.2f}x faster than real-time ✅")
    else:
        print(f"Speedup:            {rtf:.2f}x SLOWER than real-time ❌")
    print(f"Model memory:       {mem_model:.1f} MB")
    print(f"Peak memory:        {mem_after_inference:.1f} MB")
    print(f"{'-' * 80}")
    print(f"📝 Transcription: {result.full_text[:100]}...")

    return {
        "backend": backend_name,
        "audio_duration": audio_duration,
        "inference_time": inference_time,
        "rtf": rtf,
        "speedup": speedup,
        "model_memory_mb": mem_model,
        "peak_memory_mb": mem_after_inference,
        "transcription": result.full_text,
        "warmup_time": warmup_time
    }


def compare_models(
    model_size: str,
    audio: np.ndarray,
    sample_rate: int,
    language: str,
    openvino_model_path: str
):
    """
    Compare PyTorch vs OpenVINO implementations.

    Args:
        model_size: Model size (tiny, base, small, medium)
        audio: Audio samples
        sample_rate: Sample rate
        language: Language code
        openvino_model_path: Path to OpenVINO model
    """
    print("=" * 80)
    print("🔬 WHISPER BENCHMARK - PyTorch CPU vs OpenVINO")
    print("=" * 80)
    print(f"Model size:         {model_size}")
    print(f"Audio duration:     {len(audio) / sample_rate:.2f}s")
    print(f"Language:           {language if language else 'AUTO-DETECT'}")
    print(f"Sample rate:        {sample_rate} Hz")
    print("=" * 80)

    results = {}

    # Benchmark 1: PyTorch CPU (baseline)
    print("\n🐌 BASELINE: PyTorch CPU")
    print("⚠️  Warning: This will be SLOW!")
    pytorch_model = WhisperPyTorch(model_size=model_size, device="cpu")
    results["pytorch"] = benchmark_model(
        pytorch_model,
        audio,
        sample_rate,
        language,
        f"PyTorch CPU (whisper-{model_size})"
    )

    # Benchmark 2: OpenVINO
    print("\n🚀 OPTIMIZED: OpenVINO")
    if not Path(openvino_model_path).exists():
        print(f"❌ OpenVINO model not found at {openvino_model_path}")
        print(f"Run: python scripts/convert_whisper.py --model {model_size} --output {openvino_model_path}")
        print("\n⚠️  Skipping OpenVINO benchmark")
        results["openvino"] = None
    else:
        openvino_model = WhisperOpenVINO(
            model_path=openvino_model_path,
            device="CPU",
            compile=True
        )
        results["openvino"] = benchmark_model(
            openvino_model,
            audio,
            sample_rate,
            language,
            f"OpenVINO CPU (whisper-{model_size}-ov)"
        )

    # Comparison summary
    print("\n\n" + "=" * 80)
    print("📈 COMPARISON SUMMARY")
    print("=" * 80)

    if results["openvino"] is not None:
        # Performance comparison
        pytorch_time = results["pytorch"]["inference_time"]
        openvino_time = results["openvino"]["inference_time"]
        speedup_factor = pytorch_time / openvino_time

        print(f"\n⏱️  INFERENCE TIME")
        print(f"{'-' * 80}")
        print(f"PyTorch CPU:        {pytorch_time:.2f}s")
        print(f"OpenVINO CPU:       {openvino_time:.2f}s")
        print(f"Speedup:            {speedup_factor:.2f}x faster with OpenVINO 🚀")

        # RTF comparison
        pytorch_rtf = results["pytorch"]["rtf"]
        openvino_rtf = results["openvino"]["rtf"]

        print(f"\n📊 REAL-TIME FACTOR (lower is better)")
        print(f"{'-' * 80}")
        print(f"PyTorch CPU:        {pytorch_rtf:.2f}x")
        print(f"OpenVINO CPU:       {openvino_rtf:.2f}x")
        if openvino_rtf < 1.0 and pytorch_rtf >= 1.0:
            print(f"✓ OpenVINO achieves real-time, PyTorch does not!")
        elif openvino_rtf < 1.0:
            print(f"✓ Both achieve real-time, OpenVINO is {speedup_factor:.1f}x faster")

        # Memory comparison
        pytorch_mem = results["pytorch"]["model_memory_mb"]
        openvino_mem = results["openvino"]["model_memory_mb"]
        mem_reduction = ((pytorch_mem - openvino_mem) / pytorch_mem) * 100

        print(f"\n💾 MODEL MEMORY")
        print(f"{'-' * 80}")
        print(f"PyTorch CPU:        {pytorch_mem:.1f} MB")
        print(f"OpenVINO CPU:       {openvino_mem:.1f} MB")
        if mem_reduction > 0:
            print(f"Reduction:          {mem_reduction:.1f}% less memory with OpenVINO")

        # Overall verdict
        print(f"\n🏆 VERDICT")
        print(f"{'-' * 80}")
        if speedup_factor >= 3.0:
            print(f"✅ OpenVINO is {speedup_factor:.1f}x faster - EXCELLENT speedup!")
        elif speedup_factor >= 2.0:
            print(f"✅ OpenVINO is {speedup_factor:.1f}x faster - GOOD speedup!")
        elif speedup_factor >= 1.5:
            print(f"⚠️  OpenVINO is {speedup_factor:.1f}x faster - Moderate speedup")
        else:
            print(f"⚠️  OpenVINO is only {speedup_factor:.1f}x faster - Check configuration")

        print(f"\n💡 For {model_size} model:")
        if openvino_rtf < 1.0:
            print(f"   OpenVINO can run in REAL-TIME on CPU ✅")
        else:
            print(f"   Consider using 'tiny' or 'base' model for real-time performance")

    else:
        print("\n⚠️  OpenVINO benchmark skipped (model not found)")
        print(f"   Run: python scripts/convert_whisper.py --model {model_size}")

    print("=" * 80)


def main():
    parser = argparse.ArgumentParser(
        description="Compare Whisper PyTorch vs OpenVINO",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Quick test with tiny model (fast)
  python scripts/compare_whisper.py --model-size tiny

  # Test with your audio file
  python scripts/compare_whisper.py --model-size tiny --audio data/samples/test.wav

  # Test medium model (will be VERY slow on PyTorch!)
  python scripts/compare_whisper.py --model-size medium --audio data/samples/test.wav --duration 10

Note:
  - The PyTorch version will be significantly slower
  - Recommended to start with 'tiny' model for faster testing
  - OpenVINO model must be converted first (see error message if missing)
        """
    )

    parser.add_argument(
        "--model-size",
        type=str,
        default="tiny",
        choices=["tiny", "base", "small", "medium"],
        help="Whisper model size (default: tiny)"
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
        help="Language code (default: None = auto-detect)"
    )

    parser.add_argument(
        "--duration",
        type=float,
        default=10.0,
        help="Test audio duration in seconds if generating (default: 10.0)"
    )

    args = parser.parse_args()

    # Load or generate audio
    if args.audio:
        if not Path(args.audio).exists():
            print(f"❌ Error: Audio file not found at {args.audio}")
            sys.exit(1)
        audio, sample_rate = load_audio(args.audio)
    else:
        audio = generate_test_audio(duration=args.duration)
        sample_rate = 16000

    # OpenVINO model path
    openvino_model_path = f"models/whisper-{args.model_size}-ov"

    # Run comparison
    compare_models(
        model_size=args.model_size,
        audio=audio,
        sample_rate=sample_rate,
        language=args.language,
        openvino_model_path=openvino_model_path
    )


if __name__ == "__main__":
    main()
