/**
 * OfflineQueueManager — singleton service that owns all offline-queue business logic.
 *
 * Responsibilities:
 *   - enqueue()      — persist a new pending chunk entry (UUID, retry_count=0)
 *   - retryPending() — drain the FIFO queue, applying exponential backoff per entry
 *   - getQueueStats() — return live counts + storage usage for the UI indicator
 *   - Event bus       — typed events for the UI / presenter layer to subscribe to
 *
 * The actual upload is injected via configure({ uploadFn }) to keep this service
 * decoupled from TranscriptionService and testable in isolation.
 *
 * Backoff schedule (keyed on retry_count at the time of the attempt):
 *   retry_count 0 → upload immediately (first attempt, no prior failure)
 *   retry_count 1 → wait  5 s  (first retry)
 *   retry_count 2 → wait 10 s  (second retry)
 *   retry_count 3 → wait 30 s  (third retry — last allowed; mark failed on this failure)
 *
 * Max retries = 3.  A chunk at retry_count ≥ MAX_RETRIES is marked 'failed'
 * without another upload attempt.
 *
 * Events emitted:
 *   queue:synced          — all pending entries were uploaded successfully
 *   queue:chunk-failed    — a chunk exhausted its retry budget
 *   queue:storage-warning — queue storage exceeds 80 % of the 60-min audio buffer cap
 */

import { v4 as uuidv4 } from 'uuid';
import { getOfflineQueueRepository } from './index';
import type { IOfflineQueueRepository } from './IOfflineQueueRepository';
import type { OfflineQueueEntry } from '../../types/offlineQueue';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

/**
 * Delay in ms to apply before each upload attempt, indexed by retry_count.
 * Index 0 = first attempt (no wait needed).
 */
const BACKOFF_MS: ReadonlyArray<number> = [0, 5_000, 10_000, 30_000, 60_000];

/** 60 min of WebM/Opus audio at ~100 kbps ≈ 360 MB. */
const MAX_BUFFER_BYTES = 360 * 1024 * 1024;

/** Warn the nurse when buffered audio exceeds this fraction of MAX_BUFFER_BYTES. */
const STORAGE_WARNING_THRESHOLD = 0.8;

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Injected upload function.
 * Called with the chunk_ref (AudioRecording id / blob URI) and session_id.
 * Must resolve — never reject — so the manager can act on the result.
 */
export type UploadFn = (
  chunkRef: string,
  sessionId: string
) => Promise<{ success: boolean; error?: string }>;

/** Live queue metrics returned by getQueueStats(). */
export interface QueueStats {
  /** Entries with status === 'pending'. */
  pendingCount: number;
  /** Entries with status === 'failed' (max retries exhausted). */
  failedCount: number;
  /** Estimated bytes consumed by all buffered audio (platform proxy). */
  storageSizeBytes: number;
  /**
   * Fraction of MAX_BUFFER_BYTES used (0–1).
   * UI should warn when this exceeds 0.8.
   */
  percentFull: number;
}

// ─── Event types ──────────────────────────────────────────────────────────────

export interface QueueSyncedPayload {
  /** Number of chunks uploaded in this retryPending() invocation. */
  syncedCount: number;
}

export interface QueueChunkFailedPayload {
  /** The entry that has permanently failed. Kept in DB for nurse review. */
  entry: OfflineQueueEntry;
  /** Last error message from the upload attempt, if available. */
  error?: string;
}

export interface QueueStorageWarningPayload {
  storageSizeBytes: number;
  /** Fraction of the 360 MB cap (0–1). */
  percentFull: number;
}

export type QueueEvent =
  | 'queue:synced'
  | 'queue:chunk-failed'
  | 'queue:storage-warning';

type EventPayloadMap = {
  'queue:synced': QueueSyncedPayload;
  'queue:chunk-failed': QueueChunkFailedPayload;
  'queue:storage-warning': QueueStorageWarningPayload;
};

type Unsubscribe = () => void;

// ─── Manager ──────────────────────────────────────────────────────────────────

class OfflineQueueManagerClass {
  private _repo: IOfflineQueueRepository | null = null;
  private _uploadFn: UploadFn | null = null;
  /** Prevents concurrent drain loops from overlapping. */
  private _draining = false;

  private _listeners: {
    [E in QueueEvent]: Array<(payload: EventPayloadMap[E]) => void>;
  } = {
    'queue:synced': [],
    'queue:chunk-failed': [],
    'queue:storage-warning': [],
  };

  // ─── Configuration ─────────────────────────────────────────────────────────

  /**
   * Inject the upload function.
   * Must be called once before retryPending() is invoked.
   * Typical caller: ContinuousRecordingService or AppInitializer.
   *
   * @example
   * OfflineQueueManager.configure({
   *   uploadFn: (chunkRef, sessionId) =>
   *     TranscriptionService.processChunk({ recordingId: chunkRef, sessionId, ... }),
   * });
   */
  configure({ uploadFn }: { uploadFn: UploadFn }): void {
    this._uploadFn = uploadFn;
  }

  // ─── Event bus ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to a named queue event.
   * Returns an unsubscribe function (same pattern as ContinuousRecordingService).
   *
   * @example
   * const unsub = OfflineQueueManager.on('queue:chunk-failed', ({ entry }) => {
   *   showToast(`Chunk ${entry.id} failed permanently`);
   * });
   * // Later:
   * unsub();
   */
  on<E extends QueueEvent>(
    event: E,
    handler: (payload: EventPayloadMap[E]) => void
  ): Unsubscribe {
    (this._listeners[event] as Array<(p: EventPayloadMap[E]) => void>).push(handler);
    return () => {
      (this._listeners[event] as Array<(p: EventPayloadMap[E]) => void>) =
        (this._listeners[event] as Array<(p: EventPayloadMap[E]) => void>).filter(
          (h) => h !== handler
        );
    };
  }

  private _emit<E extends QueueEvent>(
    event: E,
    payload: EventPayloadMap[E]
  ): void {
    (this._listeners[event] as Array<(p: EventPayloadMap[E]) => void>).forEach(
      (h) => h(payload)
    );
  }

  // ─── Repository access ─────────────────────────────────────────────────────

  private async _getRepo(): Promise<IOfflineQueueRepository> {
    if (!this._repo) {
      this._repo = await getOfflineQueueRepository();
    }
    return this._repo;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Mark all pending entries as failed.
   * Called on app startup to discard stale chunks from a previous session
   * whose audio blobs no longer exist after a page reload.
   */
  async clearStale(): Promise<void> {
    try {
      const repo = await this._getRepo();
      const pending = await repo.getPending();
      for (const entry of pending) {
        await repo.markFailed(entry.id);
      }
      if (pending.length > 0) {
        console.log(`[OfflineQueueManager] Cleared ${pending.length} stale queue entry/entries from previous session`);
      }
    } catch (err) {
      console.warn('[OfflineQueueManager] clearStale error:', err);
    }
  }

  /**
   * Add a new audio chunk to the offline queue.
   *
   * Always creates a fresh entry (retry_count=0, status='pending').
   * After persisting, checks whether storage is >80 % full and emits
   * queue:storage-warning if so — giving the nurse an early heads-up.
   *
   * @param chunkRef  AudioRecording.id (native) or indexeddb:// URI (web)
   * @param sessionId Current shift session_id
   */
  async enqueue(chunkRef: string, sessionId: string): Promise<void> {
    const repo = await this._getRepo();

    const entry: OfflineQueueEntry = {
      id: uuidv4(),
      chunk_ref: chunkRef,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      retry_count: 0,
      status: 'pending',
    };

    await repo.enqueue(entry);
    console.log('[OfflineQueueManager] Enqueued chunk:', chunkRef);

    // Fire-and-forget storage check — must not throw.
    this._checkStorageWarning(repo).catch((err) =>
      console.warn('[OfflineQueueManager] Storage check error:', err)
    );
  }

  /**
   * Drain all pending queue entries in FIFO order.
   *
   * - Applies the per-entry backoff delay before each upload attempt.
   * - On success:  marks entry 'sent'.
   * - On failure and retry_count < MAX_RETRIES: increments retry_count, keeps 'pending'.
   * - On failure and retry_count >= MAX_RETRIES: marks 'failed', emits queue:chunk-failed.
   * - After all pending entries are processed, emits queue:synced if at least one
   *   chunk was successfully uploaded.
   *
   * Guards against concurrent invocations (_draining flag).
   * Safe to call on every network-reconnect event.
   *
   * @returns Number of chunks successfully uploaded in this invocation.
   */
  async retryPending(): Promise<number> {
    if (this._draining) {
      console.log('[OfflineQueueManager] retryPending() skipped — already draining');
      return 0;
    }
    if (!this._uploadFn) {
      console.warn('[OfflineQueueManager] retryPending() called before configure()');
      return 0;
    }

    this._draining = true;
    let syncedCount = 0;

    try {
      const repo = await this._getRepo();
      const pending = await repo.getPending();

      if (pending.length === 0) {
        console.log('[OfflineQueueManager] Queue empty — nothing to retry');
        return 0;
      }

      console.log(`[OfflineQueueManager] Retrying ${pending.length} pending chunk(s)`);

      for (const entry of pending) {
        // An entry past MAX_RETRIES somehow ended up here — clean it up.
        if (entry.retry_count >= MAX_RETRIES) {
          await repo.markFailed(entry.id);
          this._emit('queue:chunk-failed', { entry });
          continue;
        }

        // Apply the backoff delay for this retry tier.
        const delay = BACKOFF_MS[entry.retry_count] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        if (delay > 0) {
          await _sleep(delay);
        }

        const result = await this._uploadFn!(entry.chunk_ref, entry.session_id);

        if (result.success) {
          await repo.markSent(entry.id);
          syncedCount++;
          console.log('[OfflineQueueManager] Chunk sent:', entry.chunk_ref);
        } else {
          const newRetryCount = entry.retry_count + 1;

          if (newRetryCount >= MAX_RETRIES) {
            await repo.markFailed(entry.id);
            console.warn(
              `[OfflineQueueManager] Chunk permanently failed (${MAX_RETRIES} retries): ${entry.chunk_ref}`
            );
            this._emit('queue:chunk-failed', {
              entry: { ...entry, retry_count: newRetryCount, status: 'failed' },
              error: result.error,
            });
          } else {
            // Upsert with incremented retry_count, status stays 'pending'.
            await repo.enqueue({
              ...entry,
              retry_count: newRetryCount,
            });
            console.log(
              `[OfflineQueueManager] Chunk retry count → ${newRetryCount}: ${entry.chunk_ref}`
            );
          }
        }
      }

      if (syncedCount > 0) {
        this._emit('queue:synced', { syncedCount });
      }
    } catch (err) {
      console.error('[OfflineQueueManager] retryPending() error:', err);
    } finally {
      this._draining = false;
    }

    return syncedCount;
  }

  /**
   * Return live queue metrics for the UI sync-status indicator.
   *
   * percentFull is capped at 1.0 even if storage somehow exceeds MAX_BUFFER_BYTES.
   */
  async getQueueStats(): Promise<QueueStats> {
    const repo = await this._getRepo();
    const [all, storageSizeBytes] = await Promise.all([
      repo.getAll(),
      repo.getStorageSizeBytes(),
    ]);

    const pendingCount = all.filter((e) => e.status === 'pending').length;
    const failedCount = all.filter((e) => e.status === 'failed').length;
    const percentFull = Math.min(storageSizeBytes / MAX_BUFFER_BYTES, 1);

    return { pendingCount, failedCount, storageSizeBytes, percentFull };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async _checkStorageWarning(repo: IOfflineQueueRepository): Promise<void> {
    const storageSizeBytes = await repo.getStorageSizeBytes();
    const percentFull = Math.min(storageSizeBytes / MAX_BUFFER_BYTES, 1);

    if (percentFull >= STORAGE_WARNING_THRESHOLD) {
      console.warn(
        `[OfflineQueueManager] Storage ${Math.round(percentFull * 100)}% full (${(storageSizeBytes / 1024 / 1024).toFixed(0)} MB)`
      );
      this._emit('queue:storage-warning', { storageSizeBytes, percentFull });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Singleton export ─────────────────────────────────────────────────────────

const OfflineQueueManager = new OfflineQueueManagerClass();
export default OfflineQueueManager;
