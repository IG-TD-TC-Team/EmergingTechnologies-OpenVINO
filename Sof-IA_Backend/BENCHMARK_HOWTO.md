# Benchmark How-To Guide

This guide shows you how to run performance benchmarks comparing **PyTorch CPU** vs **OpenVINO INT8** for speech recognition (Whisper) and note generation (Phi-3 Mini).

**What the benchmark does:**
- Measures how fast each model processes data (latency)
- Tracks memory usage during processing
- Calculates transcription accuracy (WER) for Whisper
- Saves results to JSON files for comparison

---

## Quick Start

### Prerequisites Setup

**1. Install Python 3.12**

Download from [python.org](https://www.python.org/downloads/) or use a package manager:

```powershell
# Verify installation
python --version  # Should show Python 3.12.x
```

> **Important:** Python 3.13+ is not supported due to `optimum` compatibility issues

**2. Create and activate virtual environment**

```powershell
# Navigate to project directory

# Create virtual environment
python -m venv .venv

# Activate virtual environment
.\.venv\Scripts\activate

# You should see (.venv) in your command prompt
```

**3. Install dependencies**

```powershell
# Install all required packages
pip install -r requirements.txt

# This installs: OpenVINO, PyTorch, Transformers, FastAPI, etc.
# Expected time: ~5-10 minutes
```

---

## Step 1: Convert Models to OpenVINO

Before benchmarking, you need to convert the models from PyTorch to OpenVINO format.

**Why convert?** PyTorch models are designed for training and general-purpose inference. OpenVINO converts them into an optimized Intermediate Representation (IR) format that applies INT8 quantization, operator fusion, and Intel CPU-specific optimizations. This is what enables the 3-5× speedup we're testing.

### Convert Phi-3 Mini
**YOU CAN USE WEB INTERFACE** --> Add text TODO 
```powershell
python scripts/convert_phi3.py
```

**What this does:** Downloads Phi-3 Mini from HuggingFace and converts it to OpenVINO INT8 format

**Expected time:** ~5-10 minutes (first run only)

### Convert Whisper

```powershell
python scripts/convert_whisper.py --model medium
```

**What this does:** Downloads Whisper Medium from HuggingFace and converts it to OpenVINO INT8 format

**Expected time:** ~5-10 minutes (first run only)

> **Note:** Models are automatically enabled (`enabled: true` by default in `config/models.yaml`). You only need to edit the config if you want to temporarily disable a model by setting `enabled: false`.

---

## Step 2: Prepare Benchmark Data

The benchmark needs input data to test the models:
- **For SLM (Phi-3):** Text prompt (already included in `data/benchmark/slm_prompt.txt`)
- **For ASR (Whisper):** Audio file to transcribe

### Option A: Quick Setup (Synthetic Audio)

This creates a fake voice recording for quick testing:

```powershell
python scripts/setup_benchmark_data.py
```

**What this does:**
1. Reads the reference transcript from `data/benchmark/asr_reference.txt`
2. Uses **pyttsx3** (offline text-to-speech) to convert text → audio
3. Uses your computer's built-in TTS voice (Windows SAPI5, macOS, or Linux espeak)
4. Slows down speech to 150 words/minute for clearer pronunciation
5. Resamples audio to 16 kHz mono (Whisper's expected format)
6. Saves to `data/benchmark/asr_audio.wav` (~51 seconds)

**Output:** `data/benchmark/asr_audio.wav`

**Use this if:** You just want to test that everything works

**Limitation:** The WER (accuracy) will be artificially high (~62%) because TTS voice sounds robotic and differs from real human speech



### Option B: Real Speech Samples (Recommended for accurate results)

This downloads real human speech with verified transcripts:

```powershell
# English samples (LibriSpeech dataset)
python scripts/download_benchmark_audio.py --lang en --samples 5

# French samples (Multilingual LibriSpeech)
python scripts/download_benchmark_audio.py --lang fr --samples 5
```

**What this does:**
1. Downloads audio samples from **HuggingFace datasets** (public domain, open license)
2. Uses professional audiobook recordings with verified transcripts
3. Resamples to 16 kHz mono for Whisper compatibility
4. Saves audio + transcripts + metadata to a `manifest.json`

**Data sources:**

| Language | Dataset | Source | Quality |
|----------|---------|--------|---------|
| **English** | LibriSpeech test-clean | `openslr/librispeech_asr` | High-quality audiobooks, clean audio, manually verified transcripts |
| **French** | Multilingual LibriSpeech | `facebook/multilingual_librispeech` | French audiobooks, same quality standards as LibriSpeech |

**Output:**
- `data/benchmark/librispeech/` (English samples)
- `data/benchmark/mls_french/` (French samples)
- `manifest.json` with audio paths, transcripts, speaker IDs, and durations

**Use this if:** You want realistic WER measurements (<5% for good models) comparable to academic papers

---

### Which option should I choose?

| Scenario | Option | Why |
|----------|--------|-----|
| First time setup | **Option A** | Faster, no internet needed after TTS install |
| Quick smoke test | **Option A** | Just checking if code runs |
| Accurate benchmarks | **Option B** | Real WER measurements for your report |
| Both languages | **Option B** | Test English + French transcription |

**Tip:** You can do **Option A first** to test everything, then run **Option B** later for the final results.

---

## Step 3: Run Benchmarks

You have two options: **Web Dashboard** (easier) or **Command Line** (faster).


### Option A: Web Dashboard (Recommended)

**1. Start the server:**

```powershell
uvicorn web.server:app --reload --port 8000
```

**2. Open your browser:**

```
http://localhost:8000
```

**3. Run a benchmark:**

- Select a model from the dropdown (e.g., `phi3_pytorch` or `phi3_openvino`)
- For **SLM models** (Phi-3): Click "Use standard prompt"
- For **ASR models** (Whisper): Select an audio sample from the dropdown
- Set warmup runs: `2` (recommended)
- Set timed runs: `5` (recommended)
- Click **Start Benchmark**
- Watch the live progress in the log panel

**4. View results:**

- Go to the **Results** tab to see all past benchmarks
- Go to the **Compare** tab to compare PyTorch vs OpenVINO side-by-side

---

### Option B: Command Line

#### Run All Benchmarks at Once

This is the fastest way to benchmark all enabled models:

```powershell
python scripts/run_all_benchmarks.py --warmup 2 --timed 5
```

**What this does:**
- Runs all enabled models from `config/models.yaml`
- Uses standardized inputs (same prompt/audio for fair comparison)
- Generates a comparison table showing PyTorch vs OpenVINO speedup

**Expected output:**

```
-- SLM Results --------------------------------------------------
Model                  Status       Mean (ms)   ms/token   Load MB   Run MB
---------------------------------------------------------------------------
phi3_pytorch           OK           93386 ms   364.8 ms     53 MB    53 MB
phi3_openvino          OK           26314 ms   102.8 ms   4342 MB     0 MB

Speedup: 3.3× faster with OpenVINO INT8

-- ASR Results --------------------------------------------------
Model                  Status       Mean (ms)      WER   Load MB   Run MB
--------------------------------------------------------------------------
whisper_pytorch        OK           11712 ms    0.0%    3053 MB  3053 MB
whisper_openvino       OK            3521 ms    0.0%    1542 MB     0 MB

Speedup: 3.3× faster with OpenVINO INT8
```

#### Run Individual Models

If you want to benchmark a specific model:

**For Phi-3 (SLM):**

```powershell
# PyTorch baseline
python scripts/run_benchmark.py --model phi3_pytorch --prompt-file data/benchmark/slm_prompt.txt --warmup 2 --timed 5

# OpenVINO optimized
python scripts/run_benchmark.py --model phi3_openvino --prompt-file data/benchmark/slm_prompt.txt --warmup 2 --timed 5
```

**For Whisper (ASR):**

```powershell
# PyTorch baseline
python scripts/run_benchmark.py --model whisper_pytorch --audio data/benchmark/asr_audio.wav --reference "REFERENCE_TRANSCRIPT_HERE" --warmup 2 --timed 5

# OpenVINO optimized
python scripts/run_benchmark.py --model whisper_openvino --audio data/benchmark/asr_audio.wav --reference "REFERENCE_TRANSCRIPT_HERE" --warmup 2 --timed 5
```
### Understanding Warmup vs Timed Runs

Every benchmark runs in two phases:

**1. Warmup Runs (discarded)**
- First few runs to "warm up" the model
- **Why needed?** On first execution:
  - Python JIT (Just-In-Time) compiler optimizes hot code paths
  - OpenVINO compiles operators to optimized kernels
  - CPU caches get populated with frequently-used data
  - Memory allocations stabilize
- **Result:** First run is always slower than subsequent runs
- **Typical value:** 2-3 runs
- **Not measured**: these results are thrown away

**2. Timed Runs (measured)**
- Actual benchmark measurements after warmup
- Model is now in "steady state" (consistent performance)
- All metrics collected: latency, memory, WER
- **Typical value:** 5-10 runs
- **Used for results** 

**Example:**
```
Warmup runs (2):  Run 1: 95.2s  Run 2: 93.8s  ← discarded
Timed runs (5):   Run 1: 93.1s  Run 2: 93.5s  Run 3: 92.9s  Run 4: 93.7s  Run 5: 93.2s
                  ↑ These are used to calculate mean = 93.28s
```

**Why this matters:**
- Without warmup, your results would include slow "cold start" times
- With warmup, you measure real production performance
- More timed runs = more accurate statistics (but slower benchmarking)

---

## Understanding the Results

### Key Metrics

| Metric | What It Means |
|--------|---------------|
| **Mean latency** | Average time to process one request (lower is better) |
| **ms/token** | Time per output token for SLM models (lower is better) |
| **WER** | Word Error Rate — transcription accuracy (0% = perfect, lower is better) |
| **Load memory** | Memory used to load the model |
| **Inference memory** | Additional memory used during processing |

### What to Look For

- **Lower latency** = faster processing
- **Lower ms/token** = faster text generation
- **Lower WER** = better transcription accuracy
- **Speedup 3-5×** = OpenVINO is working correctly

### Example Interpretation

```
phi3_pytorch:     93s (baseline)
phi3_openvino:    28s (3.3× faster)
```

This means OpenVINO processes the same task **3.3 times faster** than PyTorch on CPU.

---

## Benchmark Result Files

All results are automatically saved to `results/` as JSON files with timestamps:

```
results/
    benchmark_20260319_143052.json
    benchmark_20260319_143152.json
    ...
```

Each file contains:
- Model name and configuration
- All measured metrics (latency, memory, WER)
- Timestamp
- Input/output samples

You can view and compare these files in the web dashboard (**Results** and **Compare** tabs).

---

## Troubleshooting

### "Model not found"

**Problem:** Model hasn't been converted to OpenVINO yet

**Solution:** Run the conversion scripts (Step 1)

### "optimum not found" during conversion

**Problem:** Python 3.13+ is not compatible

**Solution:** Use Python 3.12:
```powershell
python --version  # Should show 3.12.x
```

### WER is very high (>50%) on synthetic audio

**Problem:** TTS-generated audio sounds different from real speech

**Solution:** This is normal for synthetic audio. Use real speech samples for accurate WER:
```powershell
python scripts/download_benchmark_audio.py --lang en --samples 5
```

### OpenVINO not faster than PyTorch

**Problem:** First-run JIT compilation overhead

**Solution:** This is why we use warmup runs. If still slow:
- Check that `warmup` is set to at least 2
- Verify conversion used INT8 quantization
- Ensure no other heavy processes are running

### Out of memory

**Problem:** Not enough RAM for large models

**Solution:**
- Reduce `--timed` parameter (e.g., `--timed 3` instead of `5`)
- Close other applications
- Use smaller Whisper model: `--model tiny` or `base`

---

## Command Reference

### Quick Commands Summary

```powershell
# 0. Setup (first time only)
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt

# 1. Convert models (once)
python scripts/convert_phi3.py
python scripts/convert_whisper.py --model medium

# 2. Prepare data (once)
python scripts/setup_benchmark_data.py
python scripts/download_benchmark_audio.py --lang en --samples 5

# 3. Run benchmarks (repeatable)
python scripts/run_all_benchmarks.py --warmup 2 --timed 5

# 4. Start web dashboard (alternative)
uvicorn web.server:app --reload --port 8000
# Then open http://localhost:8000
```
