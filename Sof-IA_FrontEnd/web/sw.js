/**
 * Sof-IA Service Worker
 *
 * Handles background upload of pending audio chunks via the Background Sync API.
 * Runs independently of the page — chunks continue uploading even when the tab
 * is hidden or the browser is minimised.
 *
 * Sync tag : 'upload-audio-chunks'
 * DB       : 'offline_queue'  (IDB database — same name as OfflineQueueDb.js)
 * Store    : 'offline_queue'
 * Endpoint : POST /api/transcribe/chunk  multipart/form-data
 */

const SYNC_TAG     = 'upload-audio-chunks';
const DB_NAME      = 'offline_queue';
const STORE_NAME   = 'offline_queue';
const API_ENDPOINT = '/api/transcribe/chunk';

// ─── Lifecycle ────────────────────────────────────────────────────────────────

// Take control immediately — don't wait for the current page load to finish.
self.addEventListener('install', () => self.skipWaiting());

// Claim all clients so this SW controls the page without a reload.
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ─── Background Sync ──────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
    if (event.tag === SYNC_TAG) {
        event.waitUntil(uploadPendingChunks());
    }
});

// ─── Upload logic ─────────────────────────────────────────────────────────────

async function uploadPendingChunks() {
    let db;
    try {
        db = await openDb();
    } catch {
        return; // IDB unavailable — nothing to do
    }

    let chunks;
    try {
        chunks = await getAllChunks(db);
    } catch {
        db.close();
        return;
    }

    // Upload in chunk_index order — the transcription API expects ordered delivery.
    chunks.sort((a, b) => a.chunk_index - b.chunk_index);

    for (const chunk of chunks) {
        try {
            const body = new FormData();
            body.append(
                'audio',
                chunk.blob,
                `${chunk.recording_id}_${chunk.chunk_index}.webm`
            );
            body.append('session_id',   chunk.session_id);
            body.append('recording_id', chunk.recording_id);
            body.append('chunk_index',  String(chunk.chunk_index));
            body.append('mime_type',    chunk.mime_type);
            if (chunk.patient_id) body.append('patient_id', chunk.patient_id);

            const response = await fetch(API_ENDPOINT, { method: 'POST', body });

            if (response.ok) {
                await deleteChunk(db, chunk.id);
            }
            // 4xx — permanent client error; leave in queue for manual inspection.
            // 5xx — server error; browser will retry the sync event automatically.
        } catch {
            // Network error — browser will retry the sync event automatically.
        }
    }

    db.close();
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

function getAllChunks(db) {
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror   = () => reject(req.error);
    });
}

function deleteChunk(db, id) {
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).delete(id);
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
    });
}
