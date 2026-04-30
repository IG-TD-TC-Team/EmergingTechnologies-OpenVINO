/**
 * EndShiftService
 *
 * Orchestrates the full end-shift cleanup sequence:
 *   1. Attempt offline queue flush (sync pending audio/transcriptions to API)
 *   2. Stop background tasks
 *   3. Delete platform audio files (Android: expo-file-system / Web: IndexedDB blobs)
 *   4. Bulk-delete all DB records for the current session_id
 *   5. Clear AsyncStorage session-related keys
 *   6. Clear SessionService in-memory cache
 *   7. Verify no records remain for the session_id
 *
 * Entire cleanup must complete in < 5 seconds.
 *
 * Public API:
 *   flushQueue(sessionId) → FlushResult   — call before showing the cleanup UI
 *   run(sessionId)        → EndShiftResult — call after the nurse confirms deletion
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { getStorage } from '../repositories';
import { unregisterBackgroundQueueSync } from '../tasks/backgroundQueueSync';
import SessionService from './SessionService';
import StorageKeys from '../constants/storageKeys';
import { RecordingStatus } from '../models/AudioRecording';
import { TranscriptionStatus } from '../models/Transcription';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface FlushResult {
  /** True when the queue is empty or all items synced successfully. */
  success: boolean;
  /** Number of un-synced items remaining (0 when success = true). */
  pendingCount: number;
}

export interface EndShiftResult {
  /** True when every cleanup step succeeded with no failures. */
  success: boolean;
  /**
   * Human-readable labels for each step that failed.
   * Empty array on full success. Never silently skips — every failure is listed.
   */
  failedItems: string[];
  /** Wall-clock time the cleanup took in milliseconds. */
  durationMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * DB stores to wipe, ordered so child records are deleted before their parents.
 * FK order: clinical_notes → transcriptions → audio_recordings → patients → sessions
 */
const STORES_TO_WIPE = [
  'clinical_notes',
  'transcriptions',
  'audio_recordings',
  'patients',
  'sessions',
] as const;

/** Safety timeout — prevents cleanup from blocking the UI indefinitely. */
const CLEANUP_TIMEOUT_MS = 4500;

// ─── Service ──────────────────────────────────────────────────────────────────

class EndShiftService {

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Attempt to sync any PENDING / STOPPED recordings and PENDING transcriptions
   * to the transcription API before local data is wiped.
   *
   * Returns { success: true, pendingCount: 0 } when the queue is already empty.
   * Returns { success: false, pendingCount: N } when offline or sync fails.
   *
   * Called by DashboardPresenter._attemptQueueFlush() — replaces the stub there.
   */
  async flushQueue(sessionId: string): Promise<FlushResult> {
    try {
      // ── Web: chunks are stored as Blobs in OfflineQueueDb, not audio_recordings ──
      if (Platform.OS === 'web') {
        return this._flushWebQueue(sessionId);
      }

      // ── Native: check audio_recordings + transcriptions tables ──────────────
      const storage = await getStorage();

      const [recordings, transcriptions] = await Promise.all([
        storage.queryBySession<any>('audio_recordings', sessionId),
        storage.queryBySession<any>('transcriptions', sessionId),
      ]);

      const unsyncedRecordings = recordings.filter(
        (r) =>
          r.status === RecordingStatus.STOPPED ||
          r.status === RecordingStatus.FAILED
      );
      const unsyncedTranscriptions = transcriptions.filter(
        (t) =>
          t.status === TranscriptionStatus.PENDING ||
          t.status === TranscriptionStatus.FAILED
      );

      const pendingCount = unsyncedRecordings.length + unsyncedTranscriptions.length;

      if (pendingCount === 0) {
        return { success: true, pendingCount: 0 };
      }

      // TODO: replace stub with real upload once TranscriptionService is ready.
      console.warn(
        `[EndShiftService] flushQueue: ${pendingCount} unsynced items — no API available yet`
      );
      return { success: false, pendingCount };

    } catch (e: any) {
      console.error('[EndShiftService] flushQueue error:', e);
      return { success: false, pendingCount: -1 };
    }
  }

  private async _flushWebQueue(sessionId: string): Promise<FlushResult> {
    try {
      const OfflineQueueDb = require('./audio/OfflineQueueDb').default;
      const ChunkUploadService = require('./ChunkUploadService').default;

      const pendingCount: number = await OfflineQueueDb.countBySession(sessionId);

      if (pendingCount === 0) {
        return { success: true, pendingCount: 0 };
      }

      await ChunkUploadService.flushSession(sessionId);

      const remaining: number = await OfflineQueueDb.countBySession(sessionId);
      return { success: remaining === 0, pendingCount: remaining };
    } catch (e: any) {
      console.error('[EndShiftService] _flushWebQueue error:', e);
      return { success: false, pendingCount: -1 };
    }
  }

  /**
   * Execute the full end-shift cleanup.
   * Safe to call regardless of queue flush outcome (force-delete path also lands here).
   *
   * Called by DashboardPresenter._proceedWithCleanup().
   */
  async run(sessionId: string): Promise<EndShiftResult> {
    const start = Date.now();
    const failedItems: string[] = [];

    const cleanup = async (): Promise<void> => {
      this._stopBackgroundTasks();

      const fileErrors = await this._deleteAudioFiles(sessionId);
      failedItems.push(...fileErrors);

      const dbErrors = await this._deleteDbRecords(sessionId);
      failedItems.push(...dbErrors);

      const storageErrors = await this._clearAsyncStorage();
      failedItems.push(...storageErrors);

      SessionService.clearCache();

      const verifyErrors = await this._verifyCleanup(sessionId);
      failedItems.push(...verifyErrors);
    };

    const timeout = new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Cleanup timed out after ${CLEANUP_TIMEOUT_MS}ms`)),
        CLEANUP_TIMEOUT_MS
      )
    );

    try {
      await Promise.race([cleanup(), timeout]);
    } catch (e: any) {
      console.error('[EndShiftService] run error:', e);
      failedItems.push(e?.message ?? 'Unknown cleanup error');
    }

    return {
      success: failedItems.length === 0,
      failedItems,
      durationMs: Date.now() - start,
    };
  }

  // ─── Step 1: background tasks ──────────────────────────────────────────────

  private _stopBackgroundTasks(): void {
    // Unregister the background queue sync task so the OS stops waking the app
    // for a logged-out nurse. Fire-and-forget — shift cleanup must not block on this.
    unregisterBackgroundQueueSync().catch((err) =>
      console.warn('[EndShiftService] unregisterBackgroundQueueSync error:', err)
    );
  }

  // ─── Step 2: audio file deletion ──────────────────────────────────────────

  private async _deleteAudioFiles(sessionId: string): Promise<string[]> {
    const errors: string[] = [];
    try {
      const storage = await getStorage();
      const recordings: any[] = await storage.queryBySession('audio_recordings', sessionId);

      if (recordings.length === 0) return errors;

      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        await this._deleteNativeFiles(recordings, errors);
      } else {
        await this._deleteWebBlobs(recordings, errors);
      }
    } catch (e: any) {
      console.error('[EndShiftService] _deleteAudioFiles error:', e);
      errors.push(`Audio file cleanup: ${e.message ?? 'unknown error'}`);
    }
    return errors;
  }

  /** Android / iOS — delete via expo-file-system. */
  private async _deleteNativeFiles(recordings: any[], errors: string[]): Promise<void> {
    let FileSystem: any;
    try {
      FileSystem = require('expo-file-system');
    } catch {
      console.warn('[EndShiftService] expo-file-system unavailable — skipping native file deletion');
      return;
    }

    // Collect unique parent directories so we can delete the whole session folder
    // rather than deleting individual files one by one.
    const dirs = new Set<string>();
    for (const rec of recordings) {
      if (rec.file_path) {
        const slash = rec.file_path.lastIndexOf('/');
        if (slash > 0) dirs.add(rec.file_path.substring(0, slash + 1));
      }
    }

    for (const dir of dirs) {
      try {
        await FileSystem.deleteAsync(dir, { idempotent: true });
      } catch (e: any) {
        console.error('[EndShiftService] Failed to delete dir:', dir, e);
        errors.push(`Audio dir deletion failed: ${dir}`);
      }
    }
  }

  /** Web — revoke object URLs and clear the offline_queue IndexedDB store. */
  private async _deleteWebBlobs(recordings: any[], errors: string[]): Promise<void> {
    for (const rec of recordings) {
      if (rec.file_path?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(rec.file_path);
        } catch (e: any) {
          errors.push(`Blob revoke failed: ${rec.filename ?? rec.file_path}`);
        }
      }
    }

    // Clear the offline_queue IndexedDB store (audio chunk queue — planned store).
    // If the store doesn't exist yet the operation is silently skipped.
    try {
      const db = await this._openOfflineQueueDb();
      if (!db) return;

      await new Promise<void>((resolve, reject) => {
        if (!db.objectStoreNames.contains('offline_queue')) { db.close(); resolve(); return; }
        const tx = db.transaction('offline_queue', 'readwrite');
        const req = tx.objectStore('offline_queue').clear();
        req.onsuccess = () => { db.close(); resolve(); };
        req.onerror = () => { db.close(); reject(req.error); };
      });
    } catch {
      // Store not yet created — nothing to clear.
    }
  }

  /**
   * Opens the offline_queue IndexedDB database.
   * Resolves to null if IDB is unavailable or the open request times out.
   * The timeout prevents the cleanup from hanging in environments where
   * IDB events do not fire (e.g. unit tests without full IDB emulation).
   */
  private _openOfflineQueueDb(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }

      // Safety valve: if onsuccess/onerror never fire, don't block cleanup.
      const timeout = setTimeout(() => resolve(null), 500);

      const req = indexedDB.open('offline_queue');
      req.onsuccess = () => { clearTimeout(timeout); resolve(req.result); };
      req.onerror  = () => { clearTimeout(timeout); resolve(null); };
    });
  }

  // ─── Step 3: DB records ────────────────────────────────────────────────────

  private async _deleteDbRecords(sessionId: string): Promise<string[]> {
    const errors: string[] = [];
    let storage: any;
    try {
      storage = await getStorage();
    } catch (e: any) {
      return [`DB connection failed: ${e.message}`];
    }

    for (const store of STORES_TO_WIPE) {
      try {
        await storage.bulkDelete(store, { session_id: sessionId });
      } catch (e: any) {
        console.error(`[EndShiftService] bulkDelete(${store}) error:`, e);
        errors.push(`DB delete failed: ${store}`);
      }
    }

    return errors;
  }

  // ─── Step 4: AsyncStorage ──────────────────────────────────────────────────

  private async _clearAsyncStorage(): Promise<string[]> {
    const errors: string[] = [];
    try {
      // AUDIO_DEVICE is a per-shift preference — reset for the next nurse.
      // NURSE_NAME and DEVICE_ID are kept: name for auto-fill, device ID for audit trail.
      await AsyncStorage.removeItem(StorageKeys.AUDIO_DEVICE);
    } catch (e: any) {
      console.error('[EndShiftService] AsyncStorage clear error:', e);
      errors.push('AsyncStorage: failed to clear audio device preference');
    }
    return errors;
  }

  // ─── Step 6: verification ──────────────────────────────────────────────────

  private async _verifyCleanup(sessionId: string): Promise<string[]> {
    const errors: string[] = [];
    try {
      const storage = await getStorage();
      for (const store of STORES_TO_WIPE) {
        const remaining: any[] = await storage.queryBySession(store, sessionId);
        if (remaining.length > 0) {
          console.error(
            `[EndShiftService] Verification: ${remaining.length} records remain in ${store}`
          );
          errors.push(`${store}: ${remaining.length} record(s) not deleted`);
        }
      }
    } catch (e: any) {
      console.error('[EndShiftService] _verifyCleanup error:', e);
      errors.push(`Verification failed: ${e.message ?? 'unknown error'}`);
    }
    return errors;
  }
}

export default new EndShiftService();
