# Sof-IA — Local Clinical Voice Intelligence

**Module:** 63-51 Emerging Technologies  
**Professor:** Beuchat Jean-Luc  
**Students:** Cortés Julio · Da Costa Tatiana · Fernandes Gonçalves Walter

---

## What is this project?

Sof-IA is an ambient scribe application for nurses that runs entirely on-premise — no cloud, no GPU required. A nurse speaks at the bedside; the system continuously captures audio, transcribes it with **Whisper (OpenVINO INT8)**, and extracts structured clinical data with **Phi-3 Mini (OpenVINO INT8)**. The results appear as live cards in a React Native mobile app.

The project also includes a **benchmarking framework** that measures and compares PyTorch CPU vs OpenVINO INT8 inference across Whisper, Phi-3 Mini, and Apertus 8B — validating the performance case for OpenVINO on Intel CPU hospital hardware.

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
| **OpenVINO 2024.x** | Intel inference optimization — INT8/INT4 quantization, graph optimization |
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
