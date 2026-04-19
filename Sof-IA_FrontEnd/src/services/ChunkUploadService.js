/**
 * ChunkUploadService
 *
 * Uploads audio chunks from the web service-worker offline_queue to the
 * transcription API (POST /api/voice/transcribe-and-structure).
 *
 * This service handles the OfflineQueueDb (Dexie 'offline_queue') path used
 * by the web service worker and EndShiftService. Chunks here carry a direct
 * Blob rather than a filePath, so they cannot go through TranscriptionService
 * (which expects a filePath or indexeddb:// URI).
 *
 * Contract:
 *   POST /api/voice/transcribe-and-structure   multipart/form-data
 *   Fields: audio (Blob), session_id, timestamp_start, nurse_id
 *   Success response: 2xx  → chunk is deleted from IndexedDB
 *   Client error:     4xx  → not retried (permanent failure)
 *   Server/network:   5xx / TypeError → retried up to MAX_RETRIES times
 *
 * Public API:
 *   uploadChunk(chunk)       → Promise<UploadResult>
 *   flushSession(sessionId)  → Promise<FlushResult>
 *
 * @typedef {{ success: boolean, chunkId: string, error?: string, retryable?: boolean }} UploadResult
 * @typedef {{ uploaded: number, failed: number, failedChunks: Array }} FlushResult
 */

import OfflineQueueDb from './audio/OfflineQueueDb';
import SessionService from './SessionService';

export const API_ENDPOINT = '/api/voice/transcribe-and-structure';
export const MAX_RETRIES = 3;

// Exported so tests can set this to 0 without mocking timers
export let _retryDelayMs = 1000;
export function _setRetryDelayForTests(ms) { _retryDelayMs = ms; }

const ChunkUploadService = {
    /**
     * Upload a single chunk to the transcription API.
     *
     * - Retries up to MAX_RETRIES times on 5xx or network errors, with
     *   linear back-off (attempt × _retryDelayMs).
     * - 4xx responses are NOT retried — they indicate a permanent client error.
     * - The chunk is deleted from IndexedDB ONLY after a confirmed 2xx response.
     *
     * @param {object} chunk  A record from OfflineQueueDb.getBySession()
     * @returns {Promise<UploadResult>}
     */
    async uploadChunk(chunk) {
        let lastError = null;

        // Fetch nurse_id once before the retry loop
        const session = await SessionService.getActiveShift();
        const nurseId = session?.nurse_name ?? 'unknown';
        // Use chunk created_at as the best available timestamp_start approximation
        const timestampStart = chunk.created_at
            ? new Date(chunk.created_at).getTime()
            : Date.now();

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const body = new FormData();
                body.append(
                    'audio',
                    chunk.blob,
                    `${chunk.recording_id}_${chunk.chunk_index}.webm`
                );
                body.append('session_id',      chunk.session_id);
                body.append('timestamp_start', String(timestampStart));
                body.append('nurse_id',        nurseId);

                const response = await fetch(API_ENDPOINT, { method: 'POST', body });

                if (response.ok) {
                    await OfflineQueueDb.deleteById(chunk.id);
                    return { success: true, chunkId: chunk.id };
                }

                // 4xx — client error, no retry
                if (response.status >= 400 && response.status < 500) {
                    return {
                        success: false,
                        chunkId: chunk.id,
                        error: `HTTP ${response.status}`,
                        retryable: false,
                    };
                }

                // 5xx — server error, retryable
                lastError = `HTTP ${response.status}`;
            } catch (err) {
                // Network failure (offline, DNS, etc.) — retryable
                lastError = err?.message ?? 'Network error';
            }

            if (attempt < MAX_RETRIES) {
                await new Promise((r) => setTimeout(r, _retryDelayMs * attempt));
            }
        }

        return { success: false, chunkId: chunk.id, error: lastError, retryable: true };
    },

    /**
     * Upload all pending chunks for a session, in chunk_index order.
     * Sequential upload preserves ordering for the transcription API.
     * A failed chunk does not stop subsequent chunks from being attempted.
     *
     * @param {string} sessionId
     * @returns {Promise<FlushResult>}
     */
    async flushSession(sessionId) {
        const chunks = await OfflineQueueDb.getBySession(sessionId);

        if (chunks.length === 0) {
            return { uploaded: 0, failed: 0, failedChunks: [] };
        }

        let uploaded = 0;
        const failedChunks = [];

        for (const chunk of chunks) {
            const result = await this.uploadChunk(chunk);
            if (result.success) {
                uploaded++;
            } else {
                failedChunks.push({ chunk, error: result.error });
            }
        }

        return { uploaded, failed: failedChunks.length, failedChunks };
    },
};

export default ChunkUploadService;
