# Local Clinical Voice Intelligence Pipeline

## 1. Context: The Healthcare AI Challenge

Swiss healthcare facilities face a unique constraint: **patient data cannot leave hospital premises** (FADP/nLPD compliance). This rules out cloud-based AI solutions for clinical documentation.

Additionally, most hospital workstations lack NVIDIA GPUs:
- Nurse station laptops
- Ward PCs
- Bedside terminals

**The question:** Can modern AI models for speech recognition and clinical note generation run fast enough on standard Intel CPU hardware to be practical in real clinical workflows?

---

## 2. The Clinical Use Case — Sof-IA

**Sof-IA** is an ambient scribe application for nurses. A nurse speaks at the bedside while the system works in the background: audio is continuously captured, transcribed, and structured into clinical data cards — all on-premise, without any cloud dependency.

### End-to-End Flow

```
Nurse speaks at the bedside (Sof-IA mobile/web app)
    ↓
Audio is recorded in chunks (M4A on Android, WebM in browser)
    ↓
Each chunk is sent to the local FastAPI backend
    ↓
Whisper OpenVINO INT8 — transcribes audio → text
    ↓
Phi-3 Mini OpenVINO INT8 — extracts structured clinical data from transcript
    ↓
Structured cards appear live in the nurse's app
```

The app supports an **offline queue**: if the backend is temporarily unavailable, audio chunks are stored locally (IndexedDB on web, SQLite on Android) and retried automatically once the connection is restored.

### Example Workflow

1. **Nurse dictation (audio):**
   > "Patient Jane Doe, 45-year-old female, presents with acute lower back pain radiating to the left leg for three days. Pain started after lifting heavy boxes. She rates the pain as 7 out of 10. Vital signs stable. Temperature 36.8°C, blood pressure 128/82. Physical examination reveals tenderness in the lumbar region. Straight leg raise test positive on the left. Recommend ibuprofen 400mg three times daily and physical therapy referral."

2. **Whisper transcription:**
   The audio is converted to text (preserving medical terminology in English or French)

3. **Phi-3 Mini structured extraction:**
   ```
   SOAP Note — Jane Doe (45F)

   Subjective:
   - Chief complaint: Acute lower back pain radiating to left leg (3 days)
   - Onset: After lifting heavy boxes
   - Pain severity: 7/10

   Objective:
   - Vitals: Temp 36.8°C, BP 128/82
   - Examination: Lumbar tenderness, positive straight leg raise (left)

   Assessment:
   - Acute lumbar strain with left radiculopathy

   Plan:
   - Ibuprofen 400mg TID
   - Physical therapy referral
   ```

### Privacy Compliance

All processing happens **on-premise** on standard hospital hardware:
- No cloud APIs
- No external data transmission
- Full FADP/nLPD compliance

> The goal of this project is not to achieve full data protection, but to demonstrate how OpenVINO could be a viable alternative to reach that objective.
---

## 3. Why Benchmark OpenVINO vs PyTorch CPU?

While PyTorch can run on CPU, it's not optimized for Intel hardware. **OpenVINO** is Intel's open-source inference toolkit designed specifically to accelerate deep learning models on Intel CPUs through:

> PyTorch is mainly used for training deep learning models because it is flexible, easy to debug, and works very well with GPUs, which not all computers have.

However, when it comes to running models efficiently on Intel CPUs (inference), PyTorch is not specifically optimized for that hardware. This is where OpenVINO is preferred. It is Intel’s toolkit designed to speed up inference on Intel CPUs by optimizing model execution, reducing latency, and improving performance.
- **INT8 quantization** (smaller model, faster math)
- **Graph optimization**
- **Hardware-aware execution**

**Our hypothesis:** OpenVINO INT8 should deliver 3-5× speedup over baseline PyTorch CPU inference, making real-time clinical transcription and note generation viable on standard hospital PCs.

To validate this, we built a **benchmarking framework** comparing:

| Stack | Description |
|-------|-------------|
| **PyTorch CPU** | Baseline — direct inference, no optimization |
| **OpenVINO INT8** | Optimized — converted models with INT8 quantization |

**Main models tested:**
- **Whisper** (medium) — Speech recognition
- **Phi-3 Mini 4k** — Note generation

> Whisper is an open-source automatic speech recognition (ASR) model developed by OpenAI, capable of transcribing and translating audio across multiple languages.
>
>Phi-3 Mini is a lightweight large language model (LLM) developed by Microsoft, designed to deliver strong reasoning capabilities in a compact, efficient architecture.

**Metrics collected:**
- Latency (mean, p50, p95)
- Memory usage (load + inference)
- WER (Word Error Rate) for ASR quality
- RTF (Real-Time Factor) — transcription time ÷ audio duration (< 1.0 = faster than real-time)

➡️ **See:** [BENCHMARK_HOWTO.md](./BENCHMARK_HOWTO.md) for detailed instructions on running benchmarks

---

## 4. Benchmark Results

> Measured on Intel I7 CPU (11th Generation), warmup=2, timed=5 runs

### Phi-3 Mini (Clinical Note Generation)

| Backend | Mean Latency | ms/token | Load Memory | Inference Memory | Speedup |
|---------|-------------|----------|-------------|------------------|---------|
| PyTorch CPU | ~93 s | ~363 ms | ~54 MB | ~54 MB | baseline |
| OpenVINO INT8 | ~28 s | ~111 ms | ~4,342 MB | ~0 MB | **3.3× faster** |

### Whisper Medium (Speech Recognition — LibriSpeech EN, `sample_00_speaker6930`)

| Backend | Mean Latency | WER | Load Memory | Speedup |
|---------|-------------|-----|-------------|---------|
| PyTorch CPU | ~9,807 ms | 0% | ~3,064 MB | baseline |
| OpenVINO INT8 | ~6,023 ms | 0% | ~5,439 MB | **~1.6× faster** |

WER measured on LibriSpeech real speech (speaker 6930). Both backends produce identical transcripts.

### Apertus 8B Instruct (SLM, first known OpenVINO export)

| Backend | ms/token | Peak Memory | Load Memory | Speedup |
|---------|----------|-------------|-------------|---------|
| PyTorch CPU (BF16) | ~746 ms | ~14.4 GB | — | baseline |
| OpenVINO INT4 (KV cache) | ~138 ms | ~11.3 GB | ~3.5 GB | **5.4× faster** |

**Key takeaway:** OpenVINO delivers **clinically viable latency** for real-time note generation and transcription on CPU-only hardware. OpenVINO INT8 matches PyTorch accuracy (identical WER) at roughly half the latency for ASR, and 3–5× lower latency for SLM.

---

## 5. Why OpenVINO for Healthcare?

### Advantages

- **No GPU required**: runs on existing Intel hospital hardware
- **Strong CPU optimization**: 3-5× faster than PyTorch CPU
- **Full privacy compliance**: no cloud dependencies
- **Production-ready**
- **Broad model support**: PyTorch, TensorFlow, ONNX conversion

> Upper cited models can be converted into OpenVINO format for optimized inference.

### Limitations

- **Intel-centric**: no NVIDIA GPU support
- **Conversion step required**: extra pipeline complexity
- **Learning curve**: requires understanding IR format and device config

### Alternatives Comparison

| Tool | Best For | Why Not Used |
|------|----------|--------------|
| **NVIDIA TensorRT** | NVIDIA GPU inference | Hospital PCs lack NVIDIA GPUs |
| **ONNX Runtime** | Cross-platform CPU/GPU | OpenVINO better optimized for Intel CPU |
| **TensorFlow Lite** | Mobile/embedded | Desktop workstation target |

**Conclusion:** OpenVINO is the ideal solution for Swiss healthcare environments with Intel-only hardware and strict data privacy requirements.

---

## 6. End-to-End Pipeline Implementation

The project is split into two parts: a **Python backend** that handles inference, and a **React Native frontend** (Sof-IA) that nurses interact with.

### Backend — FastAPI Voice Pipeline

The backend exposes a single voice endpoint (`POST /api/voice/transcribe-and-structure`) that accepts an audio chunk, runs it through the two-model pipeline, and returns structured clinical data as JSON.

- **Audio decoding:** pydub + ffmpeg decode WebM/Opus (browser) and M4A/AAC (Android) chunks, then resample to 16 kHz mono for Whisper
- **Transcription:** Whisper Medium (OpenVINO INT8) converts the audio to text
- **Structuring:** Phi-3 Mini 4k (OpenVINO INT8) extracts clinical fields (patient info, vitals, observations, plan) from the transcript
- **Server:** FastAPI + Uvicorn, async, also serves the benchmark dashboard on the same port

### Frontend — Sof-IA Nurse App

The mobile/web app is built with **React Native + Expo** and follows a **Model-View-Presenter (MVP)** architecture, keeping business logic out of UI components.

Key screens:
- **Mode Selection** — choose between live recording and demo mode
- **Recording Mode** — microphone button, live recording indicator, audio source badge
- **Dashboard** — list of structured clinical cards received from the backend
- **Card Detail** — full view of a single clinical card
- **Settings** — configure the backend URL and other preferences

The app records audio in 30-second chunks using `expo-av` on Android and the `WebMediaRecorder` API in the browser. Chunks are submitted to the backend as they are recorded. Results stream back as cards that appear on the dashboard in real time.

**Offline resilience:** two local databases (Dexie.js on web, expo-sqlite on Android) act as a write-ahead queue. Chunks that fail to reach the backend are retried automatically.

---

## 7. Conclusion

Sof-IA demonstrates that a fully on-premise clinical voice intelligence pipeline is viable on standard Intel CPU hospital hardware. The benchmark results confirm that **OpenVINO INT8 delivers 1.6–5.4× speedups** over baseline PyTorch CPU inference — enough to make real-time transcription and note structuring practical without any GPU or cloud dependency.

The two components — the inference backend and the React Native nurse app — are independently deployable and designed to work together over a simple local HTTP API, making the system straightforward to integrate into existing hospital network environments.
