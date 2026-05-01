/**
 * IOfflineQueueRepository — platform-agnostic contract for the offline audio queue.
 *
 * The rest of the app imports only this interface; the active backend
 * (Dexie on Web, SQLite on Android) is injected by getOfflineQueueRepository().
 *
 * FIFO invariant: dequeue() always returns the oldest 'pending' entry
 * (ordered by OfflineQueueEntry.timestamp ASC).
 *
 * Retry cap: implementations must not change retry_count — callers increment
 * it before calling enqueue() or by updating the entry directly. The max-3
 * ceiling is enforced at the service layer (OfflineQueueService), not here.
 */

import { OfflineQueueEntry } from '../../types/offlineQueue';

export interface IOfflineQueueRepository {
  /**
   * Persist a new entry in the queue.
   * If an entry with the same id already exists, it is replaced.
   */
  enqueue(entry: OfflineQueueEntry): Promise<void>;

  /**
   * Return and remove the oldest 'pending' entry (FIFO).
   * Returns null when no pending entries remain.
   * The entry is NOT automatically marked as sent — callers must call
   * markSent(id) after a successful upload.
   */
  dequeue(): Promise<OfflineQueueEntry | null>;

  /**
   * Mark an entry as successfully uploaded.
   * Sets status → 'sent'. The entry is kept until explicitly deleted
   * so shift-end cleanup can verify full delivery.
   */
  markSent(id: string): Promise<void>;

  /**
   * Mark an entry as permanently failed (max retries exhausted).
   * Sets status → 'failed'. The entry is kept locally; the nurse is notified
   * by the service layer.
   */
  markFailed(id: string): Promise<void>;

  /**
   * Return all entries with status === 'pending', ordered oldest-first.
   * Used by the drain loop to process chunks in recording order.
   */
  getPending(): Promise<OfflineQueueEntry[]>;

  /**
   * Return every entry regardless of status.
   * Used by EndShiftService to verify the queue is empty before wiping data.
   */
  getAll(): Promise<OfflineQueueEntry[]>;

  /**
   * Permanently delete an entry from the queue.
   * Called after a successful upload or after the nurse force-deletes failed entries.
   */
  deleteEntry(id: string): Promise<void>;

  /**
   * Estimate the total bytes consumed by all queued audio chunks.
   *
   * Implementation notes:
   * - Dexie: navigator.storage.estimate().usage (entire IndexedDB origin)
   * - SQLite: expo-file-system database file size
   * Both are proxies; the caller uses this to warn when the buffer is >80% full
   * (threshold defined in OfflineQueueService, not here).
   */
  getStorageSizeBytes(): Promise<number>;
}
