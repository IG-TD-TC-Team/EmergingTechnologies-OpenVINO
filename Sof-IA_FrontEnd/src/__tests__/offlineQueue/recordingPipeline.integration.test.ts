/**
 * Recording pipeline — integration tests
 *
 * Tests the end-to-end flow:
 *   API failure  → TranscriptionService queues the chunk in OfflineQueueManager
 *   API restored → OfflineQueueManager.retryPending() marks the chunk 'sent'
 *
 * Uses the real OfflineQueueManager singleton backed by a fake in-memory
 * repository so the full enqueue → retry → mark-sent lifecycle is exercised
 * without any real storage or network I/O.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Inject a fake repo for the real OfflineQueueManager
jest.mock('../../services/queue/index', () => ({
  getOfflineQueueRepository: jest.fn(),
}));

// Use Math.random() to guarantee unique IDs even within the same millisecond
jest.mock('uuid', () => ({ v4: jest.fn(() => `uuid-${Math.random()}`) }));

// Stub out SessionService — TranscriptionService reads the active shift
jest.mock('../../services/SessionService', () => ({
  __esModule: true,
  default: {
    getActiveShift:    jest.fn(),
    getActiveSessionId: jest.fn(),
    clearCache:        jest.fn(),
  },
}));

// Stub out storage — only reached on successful API response (not tested here)
jest.mock('../../repositories', () => ({
  getStorage: jest.fn().mockResolvedValue({
    create:   jest.fn().mockResolvedValue({ id: 'stored-id' }),
    read:     jest.fn(),
    update:   jest.fn(),
    delete:   jest.fn(),
    queryBySession: jest.fn().mockResolvedValue([]),
    read: jest.fn(),
  }),
}));

// Stub out file-system — only reached when deleting raw audio after success
jest.mock('expo-file-system', () => ({
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

// Override capabilities so TranscriptionService uses the native (non-Dexie) path
// This avoids blob reads from IndexedDB in _buildFormData
jest.mock('../../config/capabilities', () => ({
  __esModule: true,
  capabilities: { isWeb: false },
  default:      { isWeb: false },
}));

// FormData shim (Node.js < 18 may not have it globally)
if (typeof (global as any).FormData === 'undefined') {
  (global as any).FormData = class {
    private _data: [string, unknown][] = [];
    append(key: string, value: unknown) { this._data.push([key, value]); }
  };
}

// ─── Imports ──────────────────────────────────────────────────────────────────

import OfflineQueueManager from '../../services/queue/OfflineQueueManager';
import TranscriptionService from '../../services/TranscriptionService';
import { getOfflineQueueRepository } from '../../services/queue/index';
import SessionService from '../../services/SessionService';
import type { IOfflineQueueRepository } from '../../services/queue/IOfflineQueueRepository';
import type { OfflineQueueEntry } from '../../types/offlineQueue';

// ─── Fake in-memory repository ────────────────────────────────────────────────

function makeFakeRepo(): IOfflineQueueRepository {
  const store = new Map<string, OfflineQueueEntry>();

  return {
    async enqueue(entry)  { store.set(entry.id, { ...entry }); },
    async dequeue() {
      const pending = [...store.values()]
        .filter(e => e.status === 'pending')
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      if (!pending.length) return null;
      const e = pending[0];
      store.delete(e.id);
      return e;
    },
    async markSent(id) {
      const e = store.get(id);
      if (e) store.set(id, { ...e, status: 'sent' });
    },
    async markFailed(id) {
      const e = store.get(id);
      if (e) store.set(id, { ...e, status: 'failed' });
    },
    async getPending() {
      return [...store.values()]
        .filter(e => e.status === 'pending')
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    },
    async getAll()           { return [...store.values()]; },
    async deleteEntry(id)    { store.delete(id); },
    async getStorageSizeBytes() { return 0; },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetManager() {
  const m = OfflineQueueManager as any;
  m._repo      = null;
  m._draining  = false;
  m._uploadFn  = null;
  m._listeners = {
    'queue:synced':          [],
    'queue:chunk-failed':    [],
    'queue:storage-warning': [],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Recording pipeline — integration', () => {
  let fakeRepo: IOfflineQueueRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeRepo = makeFakeRepo();
    (getOfflineQueueRepository as jest.Mock).mockResolvedValue(fakeRepo);
    resetManager();

    // Stub active shift for TranscriptionService
    (SessionService.getActiveShift as jest.Mock).mockResolvedValue({
      nurse_name: 'Nurse Test',
      started_at: '2024-01-01T07:00:00.000Z',
    });
  });

  // ── API failure → chunk enqueued ──────────────────────────────────────────

  describe('API failure → chunk appears in queue', () => {
    it('enqueues the chunk when the API returns a non-OK response', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok:     false,
        status: 503,
        json:   jest.fn().mockResolvedValue({}),
      });

      await TranscriptionService.processChunk({
        recordingId:     'rec-fail-1',
        filePath:        'file:///audio/chunk_001.m4a',
        sessionId:       'sess-integration',
        mimeType:        'audio/mp4',
        timestampStart:  1_700_000_000_000,
      });

      const stats = await OfflineQueueManager.getQueueStats();
      expect(stats.pendingCount).toBe(1);
    });

    it('enqueues the chunk when the network request throws (no connectivity)', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

      await TranscriptionService.processChunk({
        recordingId:    'rec-fail-2',
        filePath:       'file:///audio/chunk_002.m4a',
        sessionId:      'sess-integration',
        mimeType:       'audio/mp4',
        timestampStart: 1_700_000_001_000,
      });

      const stats = await OfflineQueueManager.getQueueStats();
      expect(stats.pendingCount).toBe(1);
    });

    it('enqueues the recording id (not the file path) as chunk_ref', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Offline'));

      await TranscriptionService.processChunk({
        recordingId:    'rec-specific-id',
        filePath:       'file:///audio/chunk.m4a',
        sessionId:      'sess-integration',
        mimeType:       'audio/mp4',
        timestampStart: 0,
      });

      const all = await fakeRepo.getAll();
      expect(all[0].chunk_ref).toBe('rec-specific-id');
      expect(all[0].session_id).toBe('sess-integration');
    });

    it('processChunk returns { success: false } on API failure', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Offline'));

      const result = await TranscriptionService.processChunk({
        recordingId:    'rec-3',
        filePath:       'file:///audio/chunk.m4a',
        sessionId:      'sess-integration',
        mimeType:       'audio/mp4',
        timestampStart: 0,
      });

      expect(result.success).toBe(false);
    });

    it('accumulates multiple failed chunks in the queue', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Offline'));

      await TranscriptionService.processChunk({
        recordingId: 'rec-a', filePath: 'file:///a.m4a',
        sessionId: 'sess-integration', mimeType: 'audio/mp4', timestampStart: 0,
      });
      await TranscriptionService.processChunk({
        recordingId: 'rec-b', filePath: 'file:///b.m4a',
        sessionId: 'sess-integration', mimeType: 'audio/mp4', timestampStart: 1,
      });

      const stats = await OfflineQueueManager.getQueueStats();
      expect(stats.pendingCount).toBe(2);
    });
  });

  // ── API restored → chunk dequeued and marked sent ─────────────────────────

  describe('API restored → chunk dequeued and marked sent', () => {
    it('marks the entry sent after retryPending() succeeds', async () => {
      // Step 1: chunk fails and is queued
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Offline'));
      await TranscriptionService.processChunk({
        recordingId:    'rec-retry-1',
        filePath:       'file:///audio/chunk.m4a',
        sessionId:      'sess-integration',
        mimeType:       'audio/mp4',
        timestampStart: 0,
      });

      const statsBefore = await OfflineQueueManager.getQueueStats();
      expect(statsBefore.pendingCount).toBe(1);

      // Step 2: API comes back — configure uploadFn and retry
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: true }),
      });
      await OfflineQueueManager.retryPending();

      // Queue should now be empty
      const statsAfter = await OfflineQueueManager.getQueueStats();
      expect(statsAfter.pendingCount).toBe(0);
      expect(statsAfter.failedCount).toBe(0);
    });

    it('marks multiple entries sent after batch retry', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Offline'));

      await TranscriptionService.processChunk({
        recordingId: 'rec-r1', filePath: 'file:///r1.m4a',
        sessionId: 'sess-integration', mimeType: 'audio/mp4', timestampStart: 0,
      });
      await TranscriptionService.processChunk({
        recordingId: 'rec-r2', filePath: 'file:///r2.m4a',
        sessionId: 'sess-integration', mimeType: 'audio/mp4', timestampStart: 1,
      });

      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: true }),
      });

      const synced = await OfflineQueueManager.retryPending();
      expect(synced).toBe(2);

      const stats = await OfflineQueueManager.getQueueStats();
      expect(stats.pendingCount).toBe(0);
    });

    it('emits queue:synced with the number of synced chunks', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Offline'));
      await TranscriptionService.processChunk({
        recordingId: 'rec-s1', filePath: 'file:///s1.m4a',
        sessionId: 'sess-integration', mimeType: 'audio/mp4', timestampStart: 0,
      });

      const syncedHandler = jest.fn();
      OfflineQueueManager.on('queue:synced', syncedHandler);

      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: true }),
      });
      await OfflineQueueManager.retryPending();

      expect(syncedHandler).toHaveBeenCalledWith({ syncedCount: 1 });
    });

    it('leaves failed entries in the queue when the entry is already at MAX_RETRIES', async () => {
      // Seed an entry directly at retry_count=3 (MAX_RETRIES) — retryPending()
      // marks it failed immediately without an upload attempt (no backoff delay).
      await fakeRepo.enqueue({
        id:          'at-max-retry',
        chunk_ref:   'ref-perm-fail',
        session_id:  'sess-integration',
        timestamp:   new Date().toISOString(),
        retry_count: 3,
        status:      'pending',
      });

      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });
      await OfflineQueueManager.retryPending();

      const stats = await OfflineQueueManager.getQueueStats();
      expect(stats.failedCount).toBe(1);
      expect(stats.pendingCount).toBe(0);
    });
  });
});
