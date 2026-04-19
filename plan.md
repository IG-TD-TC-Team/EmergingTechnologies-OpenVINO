# US6 — Real-time Voice Transcription & Structured Data Extraction

**Story**: As a nurse I want spoken words converted to text in real-time during patient care so that the system can analyze conversations and extract structured data for my workflow.

**Points**: 8 | **Sprint**: Sprint 2 | **Predecessor**: US5 | **Successors**: US11, US14, US22

---

## Context & Constraints

- No dedicated UI — pure background service consuming audio chunks from US5 (`WebRecorderService` / `ContinuousRecordingService`)
- API endpoint: `POST /api/voice/transcribe-and-structure` (NOT the existing `/voice/transcribe`)
- Response must be stored in a new `transcription_segments` table (separate from existing `transcriptions`)
- TTL = session start + 14h (current default is 30 days — must override)
- No raw audio persisted beyond the API call
- Data must survive app restart (loaded from storage on mount)
- Offline chunks go to the existing `OfflineQueueService` for retry

---

## API Contract

**Request** — `POST /api/voice/transcribe-and-structure`
```
multipart/form-data
  audio        — Blob (WebM/Opus from Chrome, M4A/AAC from Android)
  session_id   — string
  timestamp_start — number (ms)
  nurse_id     — string
```

**Response**
```json
{
  "transcript": "string",
  "structured": {
    "patient_name": "string | null",
    "room": "string | null",
    "vitals": "object | null",
    "medications": "string[] | null",
    "actions": "string[] | null",
    "activity_type": "string | null"
  },
  "language": "en | fr | sq | ...",
  "confidence": 0.0,
  "timestamp_start": 0,
  "timestamp_end": 0
}
```

---

## Implementation Steps

### Step 1 — Add `transcription_segments` table to storage layer

**File: `src/repositories/adapters/dexie/DexieAdapter.ts`**
- Add Dexie **version 3** stores block keeping all v2 stores plus:
  ```
  transcription_segments: 'id, session_id, audio_recording_id, bed_id, status, expires_at, [session_id+status]'
  ```
- Add `transcription_segments` to `getTable()` map and `purgeExpired()` loop.

**File: `src/repositories/adapters/sqlite/migrations.ts`**
- Add **migration version 3** (`add_transcription_segments`):
  ```sql
  CREATE TABLE IF NOT EXISTS transcription_segments (
    id TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    session_id TEXT NOT NULL,
    audio_recording_id TEXT,
    transcript TEXT NOT NULL DEFAULT '',
    structured_json TEXT,        -- JSON: patient_name, room, vitals, medications, actions, activity_type
    language TEXT NOT NULL DEFAULT 'fr',
    confidence REAL,
    ts_start INTEGER,
    ts_end INTEGER,
    bed_id TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_transcription_segments_session_id ON transcription_segments(session_id);
  CREATE INDEX IF NOT EXISTS idx_transcription_segments_expires_at ON transcription_segments(expires_at);
  ```

---

### Step 2 — Create `TranscriptionService.js`

**New file: `src/services/TranscriptionService.js`**

Responsibilities:
- Call `POST /api/voice/transcribe-and-structure` with the audio chunk
- Persist the response to `transcription_segments` with TTL = session start + 14h
- On API success: mark `audio_recording` status → `'transcribed'`, delete raw blob from `audio_blobs` (web) or filesystem (Android)
- On API failure: hand off to `OfflineQueueService` with `chunk_ref` = `recordingId`

```js
const TranscriptionService = {
  async processChunk({ recordingId, filePath, sessionId, mimeType, timestampStart }) {
    // 1. Build FormData (reuse logic from ChunkUploadService._buildFormData)
    // 2. POST to /api/voice/transcribe-and-structure
    // 3. On success: _persistSegment(), _deleteRawAudio(), _markRecordingTranscribed()
    // 4. On failure: OfflineQueueService.enqueue({ recordingId, sessionId })
  },

  async _persistSegment(apiResponse, recordingId, sessionId) {
    // expires_at = session.started_at + 14h
    // store in 'transcription_segments'
  },

  async _deleteRawAudio(filePath) {
    // Web: storage.delete('audio_blobs', blobId)
    // Android: FileSystem.deleteAsync(filePath)
  },
};
```

---

### Step 3 — Update `ChunkUploadService.js` → delegate to `TranscriptionService`

**File: `src/services/audio/ChunkUploadService.js`** (and `src/services/ChunkUploadService.js`)

- Replace the `upload()` body to call `TranscriptionService.processChunk()` instead of hitting `/voice/transcribe` directly.
- This keeps the existing callers (`WebRecorderService`, `ContinuousRecordingService`) unchanged.

---

### Step 4 — Wire TTL calculation

**File: `src/services/TranscriptionService.js`**

- On `_persistSegment`, fetch the active session to read `started_at`:
  ```js
  const session = await SessionService.getActiveSession();
  const expiresAt = new Date(new Date(session.started_at).getTime() + 14 * 60 * 60 * 1000).toISOString();
  ```
- Pass `expires_at` explicitly when calling `storage.create('transcription_segments', { ..., expires_at })`.

---

### Step 5 — Startup data restore

**File: `src/presenters/DashboardPresenter.js`**

- In `mount()`, after loading beds, call a new `_loadTranscriptionSegments()` method that reads `transcription_segments` for the active session and passes them to `this._view.setTranscriptionSegments(segments)`.
- The view interface already supports arbitrary state setters — add `setTranscriptionSegments` for downstream US11/US14 consumption.

---

### Step 6 — TTL cleanup on launch

**File: `src/repositories/adapters/dexie/DexieAdapter.ts`** & **`SqliteAdapter.ts`**

- `purgeExpired()` already iterates all stores — adding `transcription_segments` to the loop in Step 1 is sufficient.
- Confirm `purgeExpired()` is called on app launch (verify in `StorageFactory` / app init path).

---

### Step 7 — Tests

| File | What to test |
|---|---|
| `src/__tests__/services/TranscriptionService.test.js` | processChunk success → segment persisted, blob deleted; processChunk failure → enqueued in OfflineQueueService |
| `src/__tests__/integration/transcription.integration.test.js` | Full flow: fake chunk → API mock → segment in Dexie → purgeExpired removes expired segment |
| Update `ChunkUploadService.test.js` | Verify it delegates to TranscriptionService |

---

## File Checklist

| Action | File |
|---|---|
| MODIFY | `src/repositories/adapters/dexie/DexieAdapter.ts` |
| MODIFY | `src/repositories/adapters/sqlite/migrations.ts` |
| CREATE | `src/services/TranscriptionService.js` |
| MODIFY | `src/services/audio/ChunkUploadService.js` |
| MODIFY | `src/services/ChunkUploadService.js` |
| MODIFY | `src/presenters/DashboardPresenter.js` |
| CREATE | `src/__tests__/services/TranscriptionService.test.js` |
| CREATE | `src/__tests__/integration/transcription.integration.test.js` |

---

## Out of Scope

- No UI changes (US6 is a background service; UI lives in US11/US14)
- No changes to the API server
- `ContinuousRecordingService` (Android path) already calls `ChunkUploadService.upload()` — no changes needed there after Step 3