# Sof-IA — Application Deep Dive

## 1. What is Sof-IA?

Sof-IA is an **ambient scribe application for nurses**. Its purpose is simple: a nurse speaks at the bedside during normal care delivery, and the system automatically captures, transcribes, and structures that speech into clinical data cards — with no manual input and no cloud dependency.

The project is the practical demonstration layer of the broader OpenVINO benchmarking work. Where the benchmark answers "is OpenVINO fast enough on CPU?", Sof-IA answers "fast enough for what?" — a real workflow where latency and privacy both matter.

---

## 2. OpenVINO at the Core

Sof-IA's backend relies entirely on OpenVINO INT8 models. The choice is not incidental — it is the only inference stack that satisfies the three constraints of the target environment simultaneously:

| Constraint | Why OpenVINO solves it |
|------------|------------------------|
| **No GPU** on hospital workstations | Runs on Intel CPU only |
| **No cloud** (FADP/nLPD compliance) | Fully on-premise, no external calls |
| **Real-time latency** (30s chunk turnaround) | INT8 quantization delivers 1.6–3.3× speedup vs PyTorch CPU (see benchmark results) |

Both models used in the pipeline are loaded once at server startup in OpenVINO IR format and kept warm in memory for the lifetime of the server process. This avoids per-request model loading latency entirely.

### Model selection

| Model | Role in pipeline | Format |
|-------|-----------------|--------|
| **Whisper Medium** (OpenAI) | Speech-to-text — transcribes each 30-second audio chunk | OpenVINO INT8 |
| **Phi-3 Mini 4k Instruct** (Microsoft) | Text structuring — extracts clinical fields from the transcript | OpenVINO INT8 |

> For a detailed explanation of Whisper's encoder-decoder architecture and Phi-3's decoder-only transformer, see [TECHNICAL_BACKGROUND.md](./TECHNICAL_BACKGROUND.md).

---

## 3. The Voice Pipeline (Backend)

The backend is a single **FastAPI + Uvicorn** server that exposes one voice endpoint alongside the benchmark dashboard.

### Endpoint

```
POST /api/voice/transcribe-and-structure
Content-Type: multipart/form-data

Fields:
  audio           — audio chunk (WebM/Opus from browser, M4A/AAC from Android)
  session_id      — identifies the current nurse shift
  timestamp_start — recording start time (epoch ms)
  nurse_id        — identifies the nurse
```

### Processing steps

```
1. Audio decode
   pydub + ffmpeg decode the incoming container (WebM or M4A)
   → resample to 16 kHz mono float32 (Whisper's expected input)

2. Transcription  [Whisper Medium — OpenVINO INT8]
   The decoded audio array is fed to the Whisper encoder/decoder
   → raw transcript text (preserves medical terminology, supports EN/FR)

3. Structuring  [Phi-3 Mini 4k — OpenVINO INT8]
   A prompt containing the transcript is fed to Phi-3
   → structured JSON with clinical fields (see card schema below)

4. Response
   The server returns one JSON object containing both the raw transcript
   and the structured fields
```

### Response schema

```json
{
  "transcript":       "...",
  "language":         "fr",
  "confidence":       0.91,
  "timestamp_start":  1714900000000,
  "timestamp_end":    1714900030000,

  "structured": {
    "patient_name":  "Jane Doe",
    "room":          "214",
    "activity_type": "assessment",
    "actions":       ["blood pressure measured", "medication administered"],

    "medications": [
      { "medication_name": "Paracetamol", "dose": "1g", "frequency": "every 6h",
        "next_due": "2024-05-05T14:00:00Z", "administered_at": "2024-05-05T08:00:00Z" }
    ],
    "vital_signs": {
      "blood_pressure": "120/80", "heart_rate": 72, "temperature": 36.8,
      "spo2": 98, "timestamp": "2024-05-05T08:05:00Z"
    },
    "allergies": [
      { "allergen": "Penicillin", "reaction_type": "anaphylaxis", "severity": "severe" }
    ],
    "safety_info": [
      { "safety_flag": "fall_risk", "description": "Patient uses a walker, has fallen twice this month" }
    ]
  }
}
```

### Async design

The server runs with a **single Uvicorn worker** intentionally. CPU-bound inference (Whisper + Phi-3) is offloaded to a thread pool via `loop.run_in_executor()` so the async event loop stays responsive. Multiple workers would each load their own copy of both models, multiplying RAM usage.

---

## 4. The Nurse App (Frontend)

The frontend is a **React Native + Expo** application that targets Android (primary) and Chrome/Web (development and fallback). The same JavaScript codebase runs on both platforms; platform differences are abstracted behind a capabilities config.

### Screen flow

```
App launch
    └─> LoadingScreen        — initialises the local DB and active session check
            └─> ModeSelectionScreen  — choose built-in mic or Bluetooth stethoscope
                    └─> DashboardScreen    — main working screen during a shift
                            └─> CardDetailScreen  — full view of a single clinical card
                            └─> SettingsScreen    — backend URL, preferences
```

### MVP architecture

The app follows the **Model-View-Presenter (MVP)** pattern. Every screen is a pure view: it holds UI state and delegates every user action to its presenter. The presenter holds business logic, calls services, and pushes new state back to the view through a narrow interface.

```
DashboardScreen (View)           DashboardPresenter (Presenter)
──────────────────────────────   ──────────────────────────────────────────
renders beds, mic button,        onMicPress()   → starts/stops recording
  sync indicator, modals         onBedPress()   → navigates to CardDetail
calls presenter.onXxx()          onEndShift()   → flushes queue, clears DB
never calls services directly    calls: TranscriptionService, SessionService,
                                           OfflineQueueManager, StorageRepository
```

> For a deeper explanation of the MVP pattern and why it was chosen here, see [TECHNICAL_BACKGROUND.md](./TECHNICAL_BACKGROUND.md).

### Audio recording

Recording is handled differently per platform, but the output contract is the same: one audio chunk every ~30 seconds.

| Platform | API | Format | Chunk size (~30s) |
|----------|-----|--------|-------------------|
| Android | `expo-av` | M4A / AAC | ~480 KB |
| Web (Chrome) | `WebMediaRecorder API` | WebM / Opus | ~480 KB |

Each chunk is immediately persisted in local storage (IndexedDB blob on web, file system on Android) under a UUID reference, then handed to `TranscriptionService` for upload. The raw audio is deleted from local storage after a confirmed successful response.

> For a detailed explanation of the Opus and AAC codecs, see [TECHNICAL_BACKGROUND.md](./TECHNICAL_BACKGROUND.md).

---

## 5. Clinical Card System

### Fan-out pattern

When the backend responds, the frontend does two things in sequence:

1. **Persists the raw segment** — the full API response is stored as a `transcription_segment` row (including `structured_json` as a serialised string) so that the complete response is always recoverable.

2. **Fans out into card stores** — `TranscriptionService._fanOutCardData()` reads the `structured` object and writes each category of data into its own dedicated table:

```
API response.structured
    ├─> medications[]    → medications table   (one row per drug)
    ├─> vital_signs      → vital_signs table   (one row per measurement)
    ├─> allergies[]      → allergies table     (one row per allergen)
    └─> safety_info[]    → safety_info table   (one row per flag)
```

This separation allows each card type to be queried, displayed, and expired independently.

### Card types

| Card type | What it captures |
|-----------|-----------------|
| **Medications** | Drug name, dose, frequency, next due time, administered timestamp |
| **Vital Signs** | Blood pressure, heart rate, temperature, SpO2 |
| **Allergies** | Allergen, reaction type, severity |
| **Safety Info** | Safety flags (e.g. fall risk) with human-readable descriptions |

### LLM field normalisation

Phi-3 does not always return fields under the exact expected key names (especially when generating in French). The fan-out code applies alias resolution for each field:

```js
// Example — medication name field has several possible keys
medName = med.medication_name || med.name || med.drug || med.medicament || ...

// Vital signs — French aliases accepted
const vs = structured.vital_signs ?? structured.vitals ?? structured.signes_vitaux
```

This makes the pipeline robust to minor prompt-response variations without requiring a strict schema enforcement layer on the backend.

---

## 6. Session Lifecycle

### Shift concept

A **session** (shift) is created when the nurse logs in. All data produced during a shift — recordings, transcription segments, and cards — is tagged with the session ID and a **TTL expiry timestamp** (`session.started_at + 14 hours`). This ensures that even if the nurse forgets to end their shift, patient data does not persist indefinitely on the device.

### End Shift flow

When the nurse taps "End shift":

```
1. Confirmation dialog — nurse confirms intent
2. Queue flush — ChunkUploadService.flushSession() attempts to upload any
   pending audio chunks before clearing data
3. Offline gate — if chunks remain unsynced, nurse can wait or force-delete
4. Data wipe — all session tables are cleared from the local DB
5. Success screen → navigate back to LoadingScreen
```

The session wipe is intentional and irreversible. Sof-IA is designed as a **write-once, transient** store: clinical data is captured during the shift to support the nurse's memory, not as a permanent medical record system.

---

## 7. Offline Resilience

### Why it matters

Hospital Wi-Fi is not perfectly reliable. If a nurse is recording a handover at a bedside with weak signal, audio chunks must not be silently lost.

### Queue mechanism

When `TranscriptionService.processChunk()` fails (any non-2xx response or network error):

1. The audio chunk reference is written to the **offline queue** (a separate Dexie database on web, a separate SQLite table on Android)
2. `NetworkMonitor` listens to browser `online`/`offline` events
3. On reconnect, `OfflineQueueManager.retryPending()` drains the queue in FIFO order, with linear backoff (×1, ×2, ×3 seconds between retries, max 3 attempts)
4. Chunks that exceed the retry limit are marked `failed` and reported in the UI

### SyncStatusIndicator

A live status badge in the app reflects queue state:

| State | Colour | Meaning |
|-------|--------|---------|
| Idle | Hidden | No pending items |
| Offline | Orange | Buffering — chunks accumulating locally |
| Syncing | Green spinner | Uploading pending chunks |
| Failed | Red | One or more chunks could not be uploaded |

### Stale entry cleanup

Because audio blobs are held in browser origin storage and cleared on page reload, queue entries from a previous session point to blobs that no longer exist. On app startup, all `pending` entries from previous sessions are immediately marked `failed` to prevent a perpetual syncing indicator.

> For a deeper explanation of IndexedDB, Dexie.js, and the offline queue implementation, see [TECHNICAL_BACKGROUND.md](./TECHNICAL_BACKGROUND.md).
