# Benchmark How-To Guide

This guide shows you how to run performance benchmarks comparing **PyTorch CPU** vs **OpenVINO INT8** for speech recognition (Whisper) and note generation (Phi-3 Mini).

**What the benchmark does:**
- Measures how fast each model processes data (latency)
- Tracks memory usage during processing
- Calculates transcription accuracy (WER) for Whisper
- Saves results to JSON files for comparison

---

## Quick Start

> **Prerequisites and first-time setup** (Python 3.12, venv, `pip install`, model conversion) are covered in the backend section of the [README](./README.md). Complete those steps first, then return here.

---

## Step 1: Convert Models to OpenVINO

Before benchmarking, you need to convert the models from PyTorch to OpenVINO format.

**Why convert?** PyTorch models are designed for training and general-purpose inference. OpenVINO converts them into an optimized Intermediate Representation (IR) format that applies INT8 quantization, operator fusion, and Intel CPU-specific optimizations. This is what enables the 3-5× speedup we're testing.

### Convert Phi-3 Mini

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

The web dashboard is the primary interface for everything: downloading models, running benchmarks, chatting with SLMs, transcribing audio, and reading logs. You do not need to use the command line at all once the server is running.

**1. Start the server:**

```powershell
uvicorn web.server:app --reload --port 8000
```

**2. Open your browser:**

```
http://localhost:8000
```

The dashboard has four top-level modes selectable from the navigation bar: **Benchmark**, **Chat**, **Transcription**, and **Models**.

---

#### Benchmark Mode

This is the default view when you open the dashboard. It has two panels: a left panel with the run form and run history, and a right panel with tabbed result views.

**Running a benchmark:**

1. Select a model from the **Model** dropdown (e.g., `phi3_pytorch` or `phi3_openvino`). Disabled models are shown grayed out.
2. A type badge appears below the dropdown showing **SLM** or **ASR**.
3. Fill in the input:
   - **SLM models (Phi-3):** A text area appears. Click **Use standard prompt** to auto-fill the standard benchmark prompt from `data/benchmark/slm_prompt.txt`.
   - **ASR models (Whisper):** A sample picker appears. Select a sample from the grouped dropdown (English — LibriSpeech or French — MLS). The audio file path and reference transcript fill automatically. You can also type a path manually.
4. Set **Warm-up runs** (recommended: 2) and **Timed runs** (recommended: 5).
5. Click **Start Benchmark**.
6. A progress bar and live log panel appear below the button. Each step is streamed in real time from the server.
7. When complete, the result automatically appears in the **Results** tab on the right.

**Past Runs panel:**

Below the run form is a scrollable list of every benchmark that has been saved. Each entry shows:
- A colored type badge (A = ASR, S = SLM)
- The model ID
- The timestamp

Click any entry to load it into the Results tab. Entries highlighted in blue are currently selected for comparison (A or B) or currently active.

Click **Refresh** to reload the list from the server.

---

#### Results Tab

Displays the full metric table for the selected run.

| Metric shown | Meaning |
|---|---|
| Mean / p50 / p95 / Min / Max latency | Latency distribution across timed runs |
| Mean / p50 / p95 ms/token | Time per output token (SLM only) |
| Mean tokens/sec | Token throughput (SLM only) |
| Audio duration | Duration of the input audio file (ASR only) |
| Real-Time Factor (RTF) | Processing time ÷ audio duration — green if < 1 (faster than real-time) |
| Words per second | Transcription throughput (ASR only) |
| WER | Word Error Rate — green < 20%, yellow 20–50%, red > 50% |

Below the metrics table:
- **Audio player:** If the run used an audio file, a native browser audio player lets you listen to the sample directly.
- **Transcript box:** The full ASR output is shown in a scrollable code block.
- **Export JSON:** Downloads the raw result JSON to your machine.

---

#### Compare Tab

Compares two runs side by side.

1. Pick **Run A** from the first dropdown.
2. Pick **Run B** from the second dropdown.
3. Click **Compare**.

A table appears with one row per metric. The better value in each row is highlighted green. The **Diff** column shows the relative speedup or percentage improvement. The footer hint reminds you which direction is better for each metric type.

Use this tab to compare `phi3_pytorch` vs `phi3_openvino` directly — the speedup factor appears in the Diff column.

---

#### Chart Tab

Shows a bar chart of mean latency (in ms) for the two runs loaded in the Compare tab.

- Load two runs via the Compare tab first, then switch here.
- Click **Refresh chart** to redraw after changing the comparison selection.

---

#### Logs Tab

Streams the server's structured log output in real time (auto-refreshes every 5 seconds).

- Use the **level filter** dropdown to show only DEBUG, INFO, WARNING, ERROR, or CRITICAL entries.
- Each row shows: timestamp, colored level badge, logger name, job ID (when available), and the message.
- The **Job ID** column links log lines to specific benchmark or download jobs, making it easy to trace what went wrong.
- Click **Refresh** to force an immediate reload.

---

#### Chat Mode

Lets you send messages to an SLM model and receive streamed responses, with full multi-turn conversation history.

**Setup:**
1. Navigate to the **Chat** tab in the top navigation bar.
2. In the **Chat Settings** sidebar, select a model from the **Model** dropdown. Only enabled SLM models appear.
3. Edit the **System Prompt** if you want to change the assistant's persona or constraints. The default is `"You are a helpful clinical AI assistant."` — you can change it to anything.

**Sending a message:**
1. Type in the input area at the bottom of the main panel.
2. Press **Enter** (without Shift) or click **Send**.
3. The response streams token by token. A blinking cursor shows the model is still generating.
4. Each assistant bubble shows a **metrics line** after generation completes: latency, tokens/sec, and total tokens.

**Conversation memory:**
- The full conversation history is maintained server-side for the current session. Each new message includes all prior turns so the model has context.
- Click **Clear conversation** in the sidebar to wipe history and start fresh.
- Changing the model mid-conversation is allowed; history is preserved.

**Notes:**
- The chat endpoint supports Phi-3, Llama-3, and Gemma chat formats automatically — the server picks the correct template based on `chat_format` in `config/models.yaml`.
- The system prompt applies to the entire conversation and cannot be changed per-message.

---

#### Transcription Mode

Lets you run a single ASR transcription against a curated benchmark sample and immediately see the model output alongside the reference transcript, with accuracy and speed metrics.

**Setup:**
1. Navigate to the **Transcription** tab in the top navigation bar.
2. In the **ASR Settings** sidebar, select a model from the **Model** dropdown. Only enabled ASR models appear.
3. Select a **Sample** from the grouped dropdown. Samples are organized by language:
   - *English — LibriSpeech*: English audiobook recordings
   - *French — MLS*: French audiobook recordings

   The dropdown shows the audio duration and a truncated preview of the reference transcript for each sample.

**Running a transcription:**
1. Click **Transcribe**.
2. A new row appears in the main panel immediately, showing:
   - The audio filename and model used
   - **ASR** row: the model's live output (streams in, with a blinking cursor while in progress)
   - **REF** row: the ground-truth reference transcript from the dataset
3. When complete, a metrics line appears below the two text rows:
   - Audio duration (seconds)
   - RTF (Real-Time Factor) — green if faster than real-time, red if slower
   - Word count
   - Words per minute (transcription speed)
   - Processing time in seconds

**Reading the results:**
- Compare the ASR row directly against the REF row to spot substitution or insertion errors.
- RTF < 1.0 means the model processes audio faster than it plays — required for real-time clinical use.
- Run the same sample against `whisper_pytorch` and `whisper_openvino` to compare accuracy and speed visually.

**Clearing history:**
- Click **Clear history** in the sidebar to remove all transcription runs from the view.
- This does not affect saved benchmark results.

---

#### Models Tab — Model Catalogue

The Models tab is where you download, convert, and manage all models. You never need to run a conversion script manually — everything the scripts do is available here with a progress log.

**Opening the catalogue:**
- Click **Models** in the top navigation bar. The catalogue loads automatically.
- On disk models sort to the top automatically.

**Catalogue layout:**
- Each model appears as a card with:
  - A type badge (**ASR** or **SLM**)
  - A status dot: green = on disk, blue spinning = converting, grey = not downloaded
  - Model name and a short description
  - Size in GB, quantization level (INT4 / INT8), and HuggingFace repo name

**Filter bar:**
- Use the **All / ASR / SLM** filter buttons at the top right to narrow the view.

**Downloading a model:**
1. Find the model card you want.
2. For models with multiple compression options (INT4 / INT8), use the dropdown on the card to select which compression level you want.
3. Click the **OpenVINO** button to download from HuggingFace and convert to OpenVINO INT8 (or INT4).
   - For SLM models, there is also a **PyTorch (CPU baseline)** button to download the raw PyTorch weights — used to establish the unoptimized baseline for benchmarking.
4. A progress banner appears at the top of the catalogue showing:
   - The conversion step name and progress percentage
   - A live log of every step (model download, quantization, IR export)
   - A progress bar that fills as conversion advances
5. When complete, the card's status dot turns green and the button is replaced by a green checkmark badge. The model is immediately available in Benchmark, Chat, and Transcription without restarting the server.

**Gated models (HuggingFace access required):**

Some models (e.g., LLaMA) require you to accept terms on HuggingFace before downloading. If a download fails with an access error:
1. The banner shows a **"Gated model"** error with two action buttons.
2. Click **"1. Accept model terms →"** — this opens the model page on HuggingFace. Accept the terms while logged in.
3. Click **"2. Get / check your token →"** — this opens your HuggingFace token settings. Copy a token with read access.
4. Paste the token into the **HF Token** field at the top right of the Models header bar.
5. Click **OpenVINO** again — the download will now succeed.

**After downloading:**
- The model is registered in `config/models.yaml` automatically.
- It appears in the Benchmark model dropdown, the Chat model dropdown, and the Transcription model dropdown immediately.
- No server restart required.

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
| **RTF** | Real-Time Factor — processing time ÷ audio duration (< 1.0 = faster than real-time) |
| **Load memory** | Memory used to load the model |
| **Inference memory** | Additional memory used during processing |

### What to Look For

- **Lower latency** = faster processing
- **Lower ms/token** = faster text generation
- **Lower WER** = better transcription accuracy
- **RTF < 1.0** = model can process audio faster than it plays (required for real-time use)
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

**Solution:** Use the Models tab in the web dashboard to download and convert it, or run the conversion scripts (Step 1)

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

### Gated model download fails (401 Unauthorized)

**Problem:** The model requires HuggingFace account acceptance

**Solution:**
1. Accept the model terms on HuggingFace (the error banner shows a direct link)
2. Generate a read-access token at `huggingface.co/settings/tokens`
3. Paste it in the **HF Token** field in the Models tab header
4. Click the download button again

### Chat or Transcription tab shows "No enabled SLMs / No enabled ASR models"

**Problem:** No models are downloaded yet, or all models are disabled in `config/models.yaml`

**Solution:** Go to the **Models** tab and download at least one SLM (for Chat) or ASR model (for Transcription)

---

## Command Reference

> **First-time setup** (venv creation, dependency install, model conversion) is covered in the [README](./README.md). The commands below assume the environment is already active and models are already converted.

### Quick Commands Summary

```powershell
# Prepare benchmark data (once)
python scripts/setup_benchmark_data.py
python scripts/download_benchmark_audio.py --lang en --samples 5

# Run all benchmarks
python scripts/run_all_benchmarks.py --warmup 2 --timed 5

# Or start the web dashboard
uvicorn web.server:app --reload --port 8000
# Then open http://localhost:8000
```

### Web Dashboard Quick Reference

| Tab | What you can do |
|-----|----------------|
| **Benchmark → Run panel** | Select model, set input, configure warmup/timed runs, start a run, watch live progress |
| **Benchmark → Past Runs** | Click any saved run to load it into Results; refresh the list |
| **Benchmark → Results** | Full metric table, audio playback, transcript viewer, export JSON |
| **Benchmark → Compare** | Pick two runs A/B, see side-by-side metric diff with winner highlighted |
| **Benchmark → Chart** | Bar chart of mean latency for the two compared runs |
| **Benchmark → Logs** | Live server log stream; filter by level; auto-refreshes every 5s |
| **Chat** | Multi-turn conversation with any enabled SLM; customize system prompt; streaming output |
| **Transcription** | Pick ASR model + benchmark sample; see model output vs reference; RTF and WPM metrics |
| **Models** | Browse catalogue; download + convert any model to OpenVINO or PyTorch; gated model support |
