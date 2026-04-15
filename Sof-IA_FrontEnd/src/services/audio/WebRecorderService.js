/**
 * WebRecorderService
 *
 * Wraps the browser MediaRecorder API for Chrome Web ambient recording.
 *
 * Recording format: audio/webm;codecs=opus (~150-300 KB per 30-second chunk).
 * Each chunk is persisted to the Dexie offline_queue store via ondataavailable
 * before any API upload attempt. Chunks are deleted from the queue after a
 * successful API response (handled by the upload layer in a future task).
 *
 * Public API:
 *   isSupported()                       → boolean
 *   isRecording()                       → boolean
 *   start(sessionId, patientId?)        → Promise<void>
 *   stop()                              → void
 */

import { v4 as uuidv4 } from 'uuid';
import offlineQueueDb from './OfflineQueueDb';
import ServiceWorkerManager from './ServiceWorkerManager';

export const MIME_TYPE = 'audio/webm;codecs=opus';
const CHUNK_INTERVAL_MS = 30_000; // 30-second chunks per AC

const WebRecorderService = {
    _recorder: null,
    _stream: null,
    _sessionId: null,
    _patientId: null,
    _recordingId: null,
    _chunkIndex: 0,

    /**
     * Returns true when MediaRecorder is available in this browser
     * and the WebM/Opus codec is supported.
     * Always false on Android (no global MediaRecorder).
     */
    isSupported() {
        return (
            typeof MediaRecorder !== 'undefined' &&
            MediaRecorder.isTypeSupported(MIME_TYPE)
        );
    },

    /** True while a recording session is actively capturing audio. */
    isRecording() {
        return this._recorder !== null && this._recorder.state === 'recording';
    },

    /**
     * Start a new recording session.
     * Acquires the microphone, creates a MediaRecorder with a 30-second timeslice,
     * and begins persisting chunks to offline_queue on each ondataavailable event.
     *
     * Idempotent — calling start() while already recording is a no-op.
     *
     * @param {string}      sessionId  Current shift session ID.
     * @param {string|null} patientId  Optional bed/patient association.
     */
    async start(sessionId, patientId = null) {
        if (this.isRecording()) return;

        this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this._recorder = new MediaRecorder(this._stream, { mimeType: MIME_TYPE });
        this._sessionId = sessionId;
        this._patientId = patientId;
        this._recordingId = uuidv4();
        this._chunkIndex = 0;

        this._recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                this._saveChunk(event.data).catch((err) =>
                    console.error('[WebRecorderService] Failed to save chunk:', err)
                );
            }
        };

        this._recorder.start(CHUNK_INTERVAL_MS);
    },

    /**
     * Stop the current recording session and release the microphone.
     * MediaRecorder.stop() flushes the final partial chunk (< 30 s) via ondataavailable.
     * Safe to call when not recording.
     */
    stop() {
        if (!this._recorder) return;

        this._recorder.stop();
        this._stream?.getTracks().forEach((track) => track.stop());

        this._recorder = null;
        this._stream = null;
    },

    // ─── Internal ──────────────────────────────────────────────────────────────

    async _saveChunk(blob) {
        await offlineQueueDb.add({
            session_id: this._sessionId,
            recording_id: this._recordingId,
            patient_id: this._patientId,
            blob,
            mime_type: MIME_TYPE,
            chunk_index: this._chunkIndex++,
            size_bytes: blob.size,
        });
        // Schedule background upload — fires even when the tab is hidden.
        ServiceWorkerManager.requestSync().catch(() => {});
    },
};

export default WebRecorderService;
