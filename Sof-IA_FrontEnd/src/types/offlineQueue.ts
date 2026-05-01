/**
 * Represents a single audio chunk queued for upload while the API is unreachable.
 * Stored in offline_queue (Dexie.js/IndexedDB on Web, expo-sqlite on Android).
 *
 * retry_count is capped at 3. After max retries the status becomes 'failed'
 * and the chunk is kept locally until the nurse explicitly dismisses it or
 * a successful shift-end sync removes it.
 */
export interface OfflineQueueEntry {
  /** UUID v4 — primary key in offline_queue table. */
  id: string;

  /** Reference to the local audio chunk file/blob (platform-specific path or object URL). */
  chunk_ref: string;

  /** Session this chunk belongs to — used for bulk cleanup on shift end. */
  session_id: string;

  /** ISO 8601 timestamp of when the chunk was originally recorded. */
  timestamp: string;

  /** Number of upload attempts made so far. Maximum value: 3. */
  retry_count: number;

  /**
   * Lifecycle state of the queue entry:
   * - 'pending'  — waiting to be sent (initial state, or reset after reconnect)
   * - 'sent'     — successfully uploaded; safe to delete the local chunk
   * - 'failed'   — max retries exhausted; nurse must be notified
   */
  status: 'pending' | 'sent' | 'failed';
}

/**
 * Sync state surfaced in the UI indicator on the dashboard.
 *
 * - 'idle'     — queue empty, API reachable, nothing to do
 * - 'syncing'  — actively uploading queued chunks after reconnect
 * - 'offline'  — no network; chunks are being buffered locally
 * - 'failed'   — one or more chunks have exhausted retries
 */
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'failed';
