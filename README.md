# Sof-IA — Local Clinical Voice Intelligence

**Module:** 63-51 Emerging Technologies  
**Professor:** Beuchat Jean-Luc  
**Students:** Cortés Julio · Da Costa Tatiana · Fernandes Gonçalves Walter

---

## What is this project?

Sof-IA is an ambient scribe application for nurses that runs entirely on-premise — no cloud, no GPU required. A nurse speaks at the bedside; the system continuously captures audio, transcribes it with **Whisper (OpenVINO INT8)**, and extracts structured clinical data with **Phi-3 Mini (OpenVINO INT8)**. The results appear as live cards in a React Native mobile app.

The project also includes a **benchmarking framework** that measures and compares PyTorch CPU vs OpenVINO INT8 inference across Whisper, Phi-3 Mini, and Apertus 8B — validating the performance case for OpenVINO on Intel CPU hardware.

---

## Documentation

Read the documents in this order:

| Document | Contents |
|----------|----------|
| [OPENVINO_PRESENTATION.md](OPENVINO_PRESENTATION.md) | What OpenVINO is, how it works internally (Model Optimizer, IR format, Runtime), supported hardware and platforms, advantages, limitations, and comparison with TensorRT/ONNX/TFLite |
| [PROJECT_PRESENTATION.md](PROJECT_PRESENTATION.md) | Healthcare context and privacy constraints, Sof-IA clinical use case, why benchmark OpenVINO vs PyTorch CPU, benchmark results (Whisper / Phi-3 / Apertus 8B), OpenVINO advantages and limitations for healthcare, pipeline and app overview, conclusion |
| [SOFIA_PRESENTATION.md](SOFIA_PRESENTATION.md) | Sof-IA deep dive — how OpenVINO powers the pipeline, backend voice API (audio decode → Whisper → Phi-3 → structured JSON), nurse app screens and MVP architecture, clinical card system and fan-out pattern, session lifecycle, offline resilience |
| [BENCHMARK_HOWTO.md](BENCHMARK_HOWTO.md) | Step-by-step guide to converting models, preparing benchmark data, running benchmarks (web dashboard and CLI), interpreting results, troubleshooting |
| [TECHNICAL_BACKGROUND.md](TECHNICAL_BACKGROUND.md) | Theoretical foundations — transformer architecture, attention and KV cache, quantization, Whisper ASR, Phi-3 SLM, OpenVINO export pipeline, benchmark metrics, FastAPI, MVP pattern, React Native + Expo, audio codecs, IndexedDB/Dexie.js, session TTL, offline queue |

---

## How to Launch

> **Requirements:** Python 3.12, Node.js, ffmpeg on PATH

### Backend (`Sof-IA_Backend`)

**First time only:**

```powershell
cd Sof-IA_Backend

# Create venv with Python 3.12 (3.13+ is not supported)
py -3.12 -m venv .venv
.\.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Convert models — downloads from HuggingFace, runs once
# Note: convert_phi3.py uses main_export with an explicit OVWeightQuantizationConfig
# to avoid a core.read_model() crash ("stoll argument out of range") in OpenVINO ≥2025.
python scripts/convert_whisper.py --model medium
python scripts/convert_phi3.py
```

**Every launch:**

```powershell
.\.venv\Scripts\activate
python -m uvicorn web.server:app --port 8000
```

Benchmark dashboard → **http://localhost:8000**  
Voice API → **http://localhost:8000/api/voice/transcribe-and-structure**

---

### Frontend (`Sof-IA_FrontEnd`)

**First time only:**

```bash
cd Sof-IA_FrontEnd
npm install
```

Create `.env` in `Sof-IA_FrontEnd/`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8000         # browser / web
# EXPO_PUBLIC_API_URL=http://<your-local-ip>:8000  # physical device via Expo Go
```

**Every launch:**

```bash
npx expo start
```

- **Browser:** press `w`
- **Android emulator:** press `a`
- **Physical device:** install Expo Go → scan the QR code

---

## Technologies Used

### Shared infrastructure
| Technology | Role |
|-----------|------|
| **OpenVINO 2026.x** | Intel inference optimization — INT8/INT4 quantization, graph optimization |
| **optimum-intel** | HuggingFace bridge for OpenVINO model export and inference |
| **NNCF** | Neural Network Compression Framework — INT8/INT4 weight quantization |
| **PyTorch** | Baseline inference framework (used in both benchmark and pipeline) |
| **HuggingFace Transformers** | Model loading and tokenization |
| **FastAPI + Uvicorn** | Async HTTP server — serves both the benchmark dashboard and the voice API |

### Benchmark framework
| Technology | Role |
|-----------|------|
| **Whisper Medium** (OpenAI) | ASR model benchmarked — PyTorch CPU vs OpenVINO INT8 |
| **Phi-3 Mini 4k** (Microsoft) | SLM benchmarked — PyTorch CPU vs OpenVINO INT8 |
| **Apertus 8B Instruct** (swiss-ai) | Swiss multilingual SLM benchmarked — first known OpenVINO export |
| **Vue 3 + Chart.js** | Benchmark dashboard UI (CDN, no build step) |

### Sof-IA voice pipeline (backend)
| Technology | Role |
|-----------|------|
| **Whisper Medium — OpenVINO INT8** | Transcribes each 30-second audio chunk |
| **Phi-3 Mini 4k — OpenVINO INT8** | Extracts structured clinical data from the transcript |
| **pydub + ffmpeg** | Audio decoding (WebM/Opus, M4A/AAC) and resampling to 16 kHz |

### Sof-IA nurse app (frontend)
| Technology | Role |
|-----------|------|
| **React Native** | Cross-platform mobile UI (Android + Web) |
| **Expo** | Toolchain — audio APIs, file system, SQLite, QR-code dev server |
| **expo-av** | Audio recording on Android (M4A/AAC chunks) |
| **WebMediaRecorder API** | Audio recording in browser (WebM/Opus chunks) |
| **Dexie.js** | IndexedDB wrapper — main app database (`sofia_db`) + queue database (`sofia_queue`) |
| **expo-sqlite** | Local structured storage on Android |
| **React Navigation** | Screen routing (stack navigator) |

---

## Model Registry

The model list is **dynamic**. Models come from two sources:

1. **`config/models.yaml`** — the declared registry. Toggle `enabled: true/false` to control which models appear in the dashboard without touching code, or add a new entry (set `class`, `hub_id`, `model_path`, `type`) to register another model.
2. **The dashboard catalogue** — users can **download and convert (to OpenVINO IR) additional models at runtime** via `GET /api/catalogue` and `POST /api/catalogue/download` (backed by `src/model_manager/`). Downloaded models then appear alongside the declared ones.

The table below lists the models declared in `models.yaml` today — it is the default set, **not** an exhaustive or fixed list.

| ID | Label | Type | Backend | Notes |
|----|-------|------|---------|-------|
| `phi3_pytorch` | Phi-3 Mini 4k — PyTorch CPU | SLM | PyTorch | Ready |
| `phi3_openvino` | Phi-3 Mini 4k — OpenVINO INT8 | SLM | OpenVINO | Convert/download first |
| `apertus_pytorch` | Apertus 8B Instruct — PyTorch CPU | SLM | PyTorch | Ready |
| `apertus_openvino` | Apertus 8B Instruct — OpenVINO INT4 | SLM | OpenVINO | Auto-exports on first run |
| `qwen2_5_1_5b_int8_pytorch` | Qwen 2.5 1.5B — PyTorch | SLM | PyTorch | Generic loader; download via catalogue |
| `qwen2_5_1_5b_int8` | Qwen 2.5 1.5B — OpenVINO INT8 | SLM | OpenVINO | Generic loader; download/convert via catalogue |
| `qwen2_5_7b_int4` | Qwen 2.5 7B — OpenVINO INT4 | SLM | OpenVINO | Generic loader; download/convert via catalogue |
| `whisper_pytorch` | Whisper Medium — PyTorch CPU | ASR | PyTorch | Ready |
| `whisper_openvino` | Whisper Medium — OpenVINO INT8 | ASR | OpenVINO | Convert/download first |

> Qwen models use the generic loaders (`GenericSLMPyTorch` / `GenericSLMOpenVINO`), so any compatible HuggingFace causal LM can be added the same way — by config entry or catalogue download — without new Python classes.

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
│       ├── ApertusOpenVINO
│       ├── GenericSLMPyTorch     # any HF causal LM (e.g. Qwen) — PyTorch
│       └── GenericSLMOpenVINO    # any HF causal LM (e.g. Qwen) — OpenVINO
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
Sof-IA_Backend/
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
│   ├── logging_config.py              ← Structured JSON logging setup
│   ├── benchmark/
│   │   ├── base.py                    ← BaseModel, SLMBase, ASRBase, Streaming ABCs
│   │   ├── factory.py                 ← ModelFactory — reads class from YAML, lazy import
│   │   ├── runner.py                  ← Sync + async + live (streaming) runners
│   │   ├── metrics.py                 ← Latency / WER / memory / TTFT / ITL helpers
│   │   ├── repository.py              ← ResultRepository (save / list / get)
│   │   ├── resources.py               ← System/resource probing for runs
│   │   ├── report.py                  ← Comparison report generation
│   │   ├── channels.py                ← PrintProgressChannel, QueueProgressChannel
│   │   └── protocols.py               ← ProgressChannel, ModelProvider, ResultStore
│   ├── slm/
│   │   ├── phi3_pytorch.py            ← Phi3PyTorch(StreamingSLMBase)
│   │   ├── phi3_openvino.py           ← Phi3OpenVINO(StreamingSLMBase)
│   │   ├── apertus_pytorch.py         ← ApertusPyTorch(StreamingSLMBase)
│   │   ├── apertus_openvino.py        ← ApertusOpenVINO(StreamingSLMBase) — custom FX export
│   │   ├── generic_pytorch.py         ← GenericSLMPyTorch — any HF causal LM (e.g. Qwen)
│   │   └── generic_openvino.py        ← GenericSLMOpenVINO — any HF causal LM (e.g. Qwen)
│   ├── asr/
│   │   ├── base.py                    ← ASRBase / StreamingASRBase ABCs
│   │   ├── whisper_pytorch.py         ← WhisperPyTorch(ASRBase)
│   │   ├── whisper_openvino.py        ← WhisperOpenVINO(StreamingASRBase)
│   │   └── languages.py               ← Whisper supported language codes
│   ├── pipeline/
│   │   └── transcribe_and_structure.py ← Voice pipeline: ASR → structured clinical JSON
│   └── model_manager/
│       ├── catalogue.py               ← Available-model catalogue (merged with disk status)
│       ├── downloader.py              ← Background HF download + OpenVINO conversion
│       ├── registry.py                ← models.yaml registry access
│       └── disk.py                    ← Local on-disk model presence checks
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
