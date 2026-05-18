# OpenVINO

**Module:** 63-51 Emerging Technologies

**Professor:** Beuchat Jean-Luc

**Students:**
- Cortés Julio
- Da Costa Tatiana
- Fernandes Gonçalves Walter

---

## Documentation Guide

Read the documents in this order:

### 1. [OPENVINO_PRESENTATION.md](./OPENVINO_PRESENTATION.md)
**What is OpenVINO and how does it work?**

Start here if you want to understand the technology.

- What OpenVINO is and why it exists
- How inference optimization works (INT8 quantization, graph optimization)
- Internal architecture (Model Optimizer, IR format, Runtime)
- Supported platforms and limitations
- Comparison with TensorRT, ONNX Runtime, TFLite

---

### 2. [PROJECT_PRESENTATION.md](./PROJECT_PRESENTATION.md)
**The healthcare AI challenge and our solution**

- The clinical use case: why Swiss hospitals can't use cloud AI
- Voice → transcription → SOAP note pipeline
- Why we chose OpenVINO
- End-to-end pipeline implementation
- Full benchmark results and conclusions

---

### 3. [BENCHMARK_HOWTO.md](./BENCHMARK_HOWTO.md)
**Step-by-step guide to running the benchmarks yourself**

- Python environment setup
- Converting PyTorch models to OpenVINO format
- Preparing benchmark audio (TTS or real speech)
- Running benchmarks via web dashboard or CLI
- Interpreting results

---

### 4. [TECHNICAL_BACKGROUND.md](./TECHNICAL_BACKGROUND.md)
**Theoretical foundation**

Background reading if you want to understand why things work the way they do.

- Transformer architecture and attention mechanism
- Autoregressive generation (prefill vs decode)
- KV cache — what it is and why it matters
- Model quantization (INT8, INT4, weight-only)
- OpenVINO export pipeline (Path A/B/C)
- Benchmark metrics glossary

---

## Quick Start

```powershell
# 1 — Create venv (Python 3.12 required)
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt

# 2 — Convert models (downloads from HuggingFace, first run only)
.\.venv\Scripts\python scripts/convert_whisper.py --model medium
.\.venv\Scripts\python scripts/convert_phi3.py

# 3 — Prepare benchmark data
.\.venv\Scripts\python scripts/download_benchmark_audio.py --lang en --samples 5

# 4 — Start the server
.\.venv\Scripts\python -m uvicorn web.server:app --port 8000
```

Open **http://localhost:8000** — the full dashboard loads from there.

> Python 3.13+ is not supported due to `optimum-intel` compatibility constraints.

---

## Model Registry

Configured in `config/models.yaml`. Toggle `enabled: true/false` to control which models appear in the dashboard without touching code.

| ID | Label | Type | Backend | Status |
|----|-------|------|---------|--------|
| `phi3_pytorch` | Phi-3 Mini 4k — PyTorch CPU | SLM | PyTorch | Ready |
| `phi3_openvino` | Phi-3 Mini 4k — OpenVINO INT8 | SLM | OpenVINO | Ready (convert first) |
| `apertus_pytorch` | Apertus 8B Instruct — PyTorch CPU | SLM | PyTorch | Ready |
| `apertus_openvino` | Apertus 8B Instruct — OpenVINO INT4 | SLM | OpenVINO | Ready (auto-exports on first run) |
| `whisper_pytorch` | Whisper Medium — PyTorch CPU | ASR | PyTorch | Ready |
| `whisper_openvino` | Whisper Medium — OpenVINO INT8 | ASR | OpenVINO | Ready (convert first) |

---

## Architecture Overview

### OOP Hierarchy

```
BaseModel  (ABC)
├── SLMBase  (ABC)               run(prompt) -> tuple[str, int]
│   └── StreamingSLMBase  (ABC)  + run_streaming(prompt) -> Generator[token, ...]
│       ├── Phi3PyTorch
│       ├── Phi3OpenVINO
│       ├── ApertusPyTorch
│       └── ApertusOpenVINO
└── ASRBase  (ABC)               run(audio_path) -> str
    ├── WhisperPyTorch
    └── StreamingASRBase  (ABC)  + transcribe_stream(chunks) -> Generator[partial, ...]
        └── WhisperOpenVINO
```

### Design Patterns

| Pattern | Role | Location |
|---------|------|----------|
| **Strategy** | Swappable backends — caller never knows which backend runs | `BaseModel` ABC |
| **Template Method** | `_run_benchmark()` — runner calls one method, no `isinstance` dispatch | `src/benchmark/base.py` |
| **Factory** | Model instantiation from YAML `class` field — adding a model needs zero Python changes | `src/benchmark/factory.py` |
| **Repository** | Encapsulates all result file I/O | `src/benchmark/repository.py` |
| **Observer / Channel** | `ProgressChannel` protocol — `QueueProgressChannel` for SSE, `PrintProgressChannel` for CLI | `src/benchmark/channels.py` |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves the Vue dashboard |
| `GET` | `/api/models` | List all models with type, label, enabled state |
| `GET` | `/api/benchmark/inputs` | Standard prompt + audio path + reference transcript |
| `GET` | `/api/audio/samples` | All real speech samples from manifests (EN + FR) |
| `GET` | `/api/audio?path=<rel>` | Serve an audio file for the in-browser player |
| `GET` | `/api/results` | List all past result files |
| `GET` | `/api/results/{id}` | Load a specific result JSON |
| `POST` | `/api/benchmark/start` | Start batch benchmark job → returns `{job_id}` |
| `GET` | `/api/benchmark/{job_id}/stream` | SSE stream — progress / token / chunk / done events |
| `GET` | `/api/benchmark/{job_id}` | Poll job status (fallback if SSE unavailable) |
| `POST` | `/api/live/slm` | Start token-by-token SLM streaming job |
| `POST` | `/api/live/asr` | Start chunk-by-chunk ASR streaming job |
| `GET` | `/api/logs` | Last N structured log entries (filterable by level) |
| `POST` | `/api/chat` | Send a message and start a streaming SLM response → returns `{job_id}` |
| `DELETE` | `/api/chat` | Clear the in-memory chat session |
| `GET` | `/api/chat/history` | Return the current conversation as a list of messages |
| `POST` | `/api/transcription/file` | Upload an audio file (WAV/MP3/M4A/OGG/WebM/FLAC) for ASR → returns `{job_id}` |
| `POST` | `/api/transcription/sample` | Transcribe a curated benchmark sample by path → returns `{job_id}` |
| `GET` | `/api/catalogue` | Return the model catalogue merged with local disk status |
| `POST` | `/api/catalogue/download` | Start a background download + OpenVINO conversion job → returns `{job_id}` |
| `POST` | `/api/voice/transcribe-and-structure` | Full voice pipeline — transcribe audio chunk and extract structured clinical data |

---

## Repository Structure

```
OpenVino/
├── README.md                          ← You are here
├── OPENVINO_PRESENTATION.md           ← Technology deep-dive
├── PROJECT_PRESENTATION.md            ← Project document
├── BENCHMARK_HOWTO.md                 ← How to run benchmarks
├── TECHNICAL_BACKGROUND.md            ← Theory (transformers, KV cache, export pipeline)
│
├── config/
│   └── models.yaml                    ← Model registry (class, path, type, enabled)
│
├── data/
│   ├── benchmark/                     ← Standard benchmark inputs
│   │   ├── slm_prompt.txt             ← 128-word clinical dictation
│   │   ├── asr_audio.wav              ← TTS clinical audio (not used for WER evaluation)
│   │   └── asr_reference.txt          ← Ground-truth transcript
│   └── prompts/
│       └── clinical_note_prompt.txt   ← SOAP note template
│
├── models/                            ← Converted OpenVINO models (git-ignored, large)
├── results/                           ← Benchmark JSON output (git-ignored content)
├── logs/                              ← Structured JSON logs (git-ignored)
│
├── scripts/
│   ├── run_benchmark.py               ← CLI: batch / live-slm / live-asr subcommands
│   ├── run_all_benchmarks.py          ← All models, standardized inputs, comparison table
│   ├── convert_phi3.py                ← Export Phi-3 Mini → OpenVINO IR (INT8)
│   ├── convert_whisper.py             ← Export Whisper → OpenVINO IR (INT8)
│   ├── setup_benchmark_data.py        ← Generate TTS benchmark audio
│   └── download_benchmark_audio.py    ← Download LibriSpeech (EN) / MLS (FR) samples
│
├── src/
│   ├── benchmark/
│   │   ├── base.py                    ← BaseModel, SLMBase, ASRBase, Streaming ABCs
│   │   ├── factory.py                 ← ModelFactory — reads class from YAML, lazy import
│   │   ├── runner.py                  ← Sync + async + live (streaming) runners
│   │   ├── metrics.py                 ← Latency / WER / memory / TTFT / ITL helpers
│   │   ├── repository.py              ← ResultRepository (save / list / get)
│   │   ├── channels.py                ← PrintProgressChannel, QueueProgressChannel
│   │   └── protocols.py               ← ProgressChannel, ModelProvider, ResultStore
│   ├── slm/
│   │   ├── phi3_pytorch.py            ← Phi3PyTorch(StreamingSLMBase)
│   │   ├── phi3_openvino.py           ← Phi3OpenVINO(StreamingSLMBase)
│   │   ├── apertus_pytorch.py         ← ApertusPyTorch(StreamingSLMBase)
│   │   └── apertus_openvino.py        ← ApertusOpenVINO(StreamingSLMBase) — custom FX export
│   └── asr/
│       ├── whisper_pytorch.py         ← WhisperPyTorch(ASRBase)
│       ├── whisper_openvino.py        ← WhisperOpenVINO(StreamingASRBase)
│       └── languages.py               ← Whisper supported language codes
│
├── web/
│   ├── server.py                      ← FastAPI app (all endpoints + SSE)
│   ├── jobs.py                        ← In-memory job store (PENDING → RUNNING → DONE/FAILED)
│   ├── sessions.py                    ← In-memory chat session store (multi-turn history)
│   ├── middleware.py                  ← Request logging middleware
│   └── static/
│       ├── index.html                 ← HTML skeleton — mounts Vue app
│       ├── app.css                    ← All styles
│       ├── api.js                     ← Service layer (fetch / EventSource)
│       ├── app.js                     ← Root assembly — wires composable stores
│       └── composables/
│           ├── models.js              ← ModelsStore
│           ├── benchmark.js           ← BenchmarkStore
│           ├── history.js             ← HistoryStore
│           ├── compare.js             ← CompareStore
│           ├── chart.js               ← ChartStore (Chart.js)
│           ├── logs.js                ← LogsStore (server log viewer, auto-refresh)
│           ├── chat.js                ← ChatStore (multi-turn SLM chat, streaming)
│           ├── catalogue.js           ← CatalogueStore (model download + conversion)
│           └── transcription.js       ← TranscriptionStore (ASR sample runner)
│
└── requirements.txt
```

---

## Technologies Used

- **OpenVINO 2026.x** — Intel inference optimization toolkit
- **optimum-intel** — HuggingFace bridge for OpenVINO model export and inference
- **PyTorch** — Baseline framework for comparison
- **NNCF** — Neural Network Compression Framework (INT8/INT4 weight quantization)
- **Whisper** (OpenAI) — Speech recognition model (medium)
- **Phi-3 Mini 4k** (Microsoft) — Lightweight language model
- **Apertus 8B Instruct** (swiss-ai) — Swiss multilingual LLM (novel architecture)
- **FastAPI + Uvicorn** — Web dashboard backend
- **HuggingFace Transformers + optimum** — Model loading and export
- **Vue 3 + Chart.js** — Dashboard frontend (CDN, no build step)
