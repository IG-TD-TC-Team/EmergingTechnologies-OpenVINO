/**
 * Sof-IA Service Worker
 *
 * Handles background upload of pending audio chunks via the Background Sync API,
 * and notifies page clients to call OfflineQueueManager.retryPending() when the
 * transcription API becomes reachable again.
 *
 * ─── Responsibilities ────────────────────────────────────────────────────────
 * 1. Background Sync ('upload-audio-chunks'):
 *    Upload queued blobs from IndexedDB. On any upload failure, post
 *    { type: 'QUEUE_RETRY' } to all clients so OfflineQueueManager can drain
 *    the typed offline_queue with proper backoff.
 *
 * 2. Fetch interception (POST /api/voice/transcribe-and-structure):
 *    Observe transcription API calls made by the page. On network error or 5xx,
 *    post { type: 'QUEUE_RETRY' } to clients. This catches failures that happen
 *    when the page is the one initiating the upload (foreground path).
 *    The failed response is always passed through to the page unchanged — the
 *    page's own error handling (TranscriptionService catch block) remains the
 *    primary queue mechanism.
 *
 * ─── Client message protocol ─────────────────────────────────────────────────
 * SW → page: { type: 'QUEUE_RETRY' }
 *   Triggers OfflineQueueManager.retryPending() in ServiceWorkerManager.js.
 *
 * ─── DB ──────────────────────────────────────────────────────────────────────
 * Sync event reads from the legacy 'offline_queue' IDB database (OfflineQueueDb.js
 * blob store). The typed queue (DexieQueueRepository / sofia_queue) is drained
 * entirely by OfflineQueueManager on the page side.
 */

const SYNC_TAG            = 'upload-audio-chunks';
const DB_NAME             = 'offline_queue';
const STORE_NAME          = 'offline_queue';
const TRANSCRIPTION_PATH  = '/api/voice/transcribe-and-structure';

// ─── Lifecycle ────────────────────────────────────────────────────────────────

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// ─── Background Sync ──────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
    if (event.tag === SYNC_TAG) {
        event.waitUntil(uploadPendingChunks());
    }
});

// ─── Fetch interception ───────────────────────────────────────────────────────
//
// Only intercept POST requests to the transcription endpoint. All other fetches
// fall through untouched (no event.respondWith called → browser handles normally).
//
// When the transcription API is unreachable (network error) or returns a 5xx:
//   → post QUEUE_RETRY to all page clients
//   → return the original failed response / error so TranscriptionService's
//     catch block still fires and enqueues the chunk via OfflineQueueManager.

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== 'POST' || !url.pathname.endsWith(TRANSCRIPTION_PATH)) {
        return; // not our concern
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (!response.ok && response.status >= 500) {
                    // Server error — API unreachable or overloaded.
                    notifyClientsQueueRetry();
                }
                return response;
            })
            .catch((err) => {
                // Network failure (offline, DNS, timeout).
                notifyClientsQueueRetry();
                // Re-throw as a network error response so the page's catch fires.
                return Response.error();
            })
    );
});

// ─── Upload logic (Background Sync path) ─────────────────────────────────────

async function uploadPendingChunks() {
    let db;
    try {
        db = await openDb();
    } catch {
        return;
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

    let hadFailure = false;

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

            const response = await fetch(TRANSCRIPTION_PATH, { method: 'POST', body });

            if (response.ok) {
                await deleteChunk(db, chunk.id);
            } else if (response.status < 500) {
                // 4xx — permanent client error; keep for manual inspection.
                hadFailure = true;
            } else {
                // 5xx — transient server error; browser re-fires sync automatically.
                hadFailure = true;
            }
        } catch {
            // Network error — browser will retry the sync event automatically.
            hadFailure = true;
        }
    }

    db.close();

    // Tell the page to drain the typed queue (DexieQueueRepository) as well,
    // now that we know the network was available (at least partially).
    if (!hadFailure) {
        // All uploads succeeded — queue may have items from a previous session.
        notifyClientsQueueRetry();
    }
}

// ─── Client notification ──────────────────────────────────────────────────────

async function notifyClientsQueueRetry() {
    try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
        for (const client of clients) {
            client.postMessage({ type: 'QUEUE_RETRY' });
        }
    } catch (_) {
        // clients.matchAll() may fail in some environments — non-fatal.
    }
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
