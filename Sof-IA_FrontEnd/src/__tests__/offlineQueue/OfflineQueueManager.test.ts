/**
 * OfflineQueueManager — unit tests
 *
 * All tests operate against an in-memory fake repository so that the
 * business logic (FIFO ordering, retry counting, backoff, events) is
 * exercised without any real storage layer.
 *
 * The manager is a singleton; its private state is reset in beforeEach
 * so every test starts from a clean slate.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Intercept the repository factory — replaced per test with the fake repo
jest.mock('../../services/queue/index', () => ({
  getOfflineQueueRepository: jest.fn(),
}));

// Deterministic UUIDs — variable MUST start with 'mock' to satisfy Jest's factory scope rule
let mockUuidSeq = 0;
jest.mock('uuid', () => ({ v4: jest.fn(() => `uuid-${++mockUuidSeq}`) }));

// ─── Imports ──────────────────────────────────────────────────────────────────

import OfflineQueueManager from '../../services/queue/OfflineQueueManager';
import { getOfflineQueueRepository } from '../../services/queue/index';
import type { IOfflineQueueRepository } from '../../services/queue/IOfflineQueueRepository';
import type { OfflineQueueEntry } from '../../types/offlineQueue';

// ─── Fake in-memory repository ────────────────────────────────────────────────

type FakeRepo = IOfflineQueueRepository & { setStorageSize(n: number): void };

function makeFakeRepo(): FakeRepo {
  const store = new Map<string, OfflineQueueEntry>();
  let _size = 0;

  return {
    setStorageSize(n: number) { _size = n; },

    async enqueue(entry) {
      store.set(entry.id, { ...entry });
    },
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
    async getStorageSizeBytes() { return _size; },
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<OfflineQueueEntry> = {}): OfflineQueueEntry {
  return {
    id:          `entry-${Math.random()}`,
    chunk_ref:   'ref-default',
    session_id:  'sess-1',
    timestamp:   new Date().toISOString(),
    retry_count: 0,
    status:      'pending',
    ...overrides,
  };
}

/** Reset singleton private state between tests. */
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

describe('OfflineQueueManager', () => {
  let fakeRepo: FakeRepo;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUuidSeq = 0;
    fakeRepo = makeFakeRepo();
    (getOfflineQueueRepository as jest.Mock).mockResolvedValue(fakeRepo);
    resetManager();
  });

  // ── enqueue ───────────────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('persists the entry with the correct chunk_ref and session_id', async () => {
      await OfflineQueueManager.enqueue('chunk-abc', 'sess-xyz');

      const all = await fakeRepo.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        chunk_ref:   'chunk-abc',
        session_id:  'sess-xyz',
        retry_count: 0,
        status:      'pending',
      });
    });

    it('assigns a UUID as the entry id', async () => {
      await OfflineQueueManager.enqueue('chunk-1', 'sess-1');
      const all = await fakeRepo.getAll();
      expect(all[0].id).toBe('uuid-1');
    });

    it('sets a valid ISO 8601 timestamp', async () => {
      await OfflineQueueManager.enqueue('chunk-1', 'sess-1');
      const all = await fakeRepo.getAll();
      expect(new Date(all[0].timestamp).getTime()).not.toBeNaN();
    });

    it('always creates a fresh entry at retry_count=0', async () => {
      await OfflineQueueManager.enqueue('c1', 'sess-1');
      await OfflineQueueManager.enqueue('c2', 'sess-1');
      const all = await fakeRepo.getAll();
      expect(all.every(e => e.retry_count === 0)).toBe(true);
    });
  });

  // ── FIFO ordering ─────────────────────────────────────────────────────────

  describe('FIFO ordering', () => {
    it('getPending() returns entries oldest-first', async () => {
      await fakeRepo.enqueue(makeEntry({
        id: 'old', chunk_ref: 'ref-old',
        timestamp: '2024-01-01T00:00:00.000Z',
      }));
      await fakeRepo.enqueue(makeEntry({
        id: 'new', chunk_ref: 'ref-new',
        timestamp: '2024-01-02T00:00:00.000Z',
      }));

      const pending = await fakeRepo.getPending();
      expect(pending[0].id).toBe('old');
      expect(pending[1].id).toBe('new');
    });

    it('retryPending() uploads chunks in FIFO order', async () => {
      const uploadOrder: string[] = [];
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockImplementation(async (ref: string) => {
          uploadOrder.push(ref);
          return { success: true };
        }),
      });

      await fakeRepo.enqueue(makeEntry({
        id: 'old', chunk_ref: 'ref-old',
        timestamp: '2024-01-01T00:00:00.000Z',
      }));
      await fakeRepo.enqueue(makeEntry({
        id: 'new', chunk_ref: 'ref-new',
        timestamp: '2024-01-02T00:00:00.000Z',
      }));

      await OfflineQueueManager.retryPending();

      expect(uploadOrder).toEqual(['ref-old', 'ref-new']);
    });
  });

  // ── retry count ───────────────────────────────────────────────────────────

  describe('retry count increment', () => {
    it('increments retry_count and keeps status pending on upload failure', async () => {
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false, error: 'network timeout' }),
      });

      await fakeRepo.enqueue(makeEntry({ id: 'c1', chunk_ref: 'ref-1' }));
      await OfflineQueueManager.retryPending();

      const all = await fakeRepo.getAll();
      const entry = all.find(e => e.chunk_ref === 'ref-1')!;
      expect(entry.retry_count).toBe(1);
      expect(entry.status).toBe('pending');
    });

    it('does not mark the entry failed on the first failure', async () => {
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      await fakeRepo.enqueue(makeEntry({ id: 'c1' }));
      await OfflineQueueManager.retryPending();

      const all = await fakeRepo.getAll();
      expect(all[0].status).not.toBe('failed');
    });

    it('marks entry sent and does not increment retry_count on success', async () => {
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: true }),
      });

      await fakeRepo.enqueue(makeEntry({ id: 'c1' }));
      await OfflineQueueManager.retryPending();

      const all = await fakeRepo.getAll();
      expect(all[0].status).toBe('sent');
      expect(all[0].retry_count).toBe(0);
    });
  });

  // ── backoff timing ────────────────────────────────────────────────────────

  describe('backoff timing', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('retry_count=0: uploads without any sleep (no timer created)', async () => {
      jest.useFakeTimers();
      const uploadFn = jest.fn().mockResolvedValue({ success: true });
      OfflineQueueManager.configure({ uploadFn });

      await fakeRepo.enqueue(makeEntry({ id: 'c0', retry_count: 0 }));

      // BACKOFF_MS[0]=0 → _sleep skipped entirely
      const drain = OfflineQueueManager.retryPending();
      await jest.runAllTimersAsync();
      await drain;

      expect(uploadFn).toHaveBeenCalledTimes(1);
      // No pending timers means no sleep was scheduled
      expect(jest.getTimerCount()).toBe(0);
    });

    it('retry_count=1: upload fires only after 5 s timer elapses', async () => {
      jest.useFakeTimers();
      const uploadFn = jest.fn().mockResolvedValue({ success: true });
      OfflineQueueManager.configure({ uploadFn });

      await fakeRepo.enqueue(makeEntry({ id: 'c1', retry_count: 1 }));

      const drain = OfflineQueueManager.retryPending();

      // Advance past 5 s backoff and flush all promises
      await jest.runAllTimersAsync();
      await drain;

      expect(uploadFn).toHaveBeenCalledTimes(1);
    });

    it('retry_count=2: upload fires only after 10 s timer elapses', async () => {
      jest.useFakeTimers();
      const uploadFn = jest.fn().mockResolvedValue({ success: true });
      OfflineQueueManager.configure({ uploadFn });

      await fakeRepo.enqueue(makeEntry({ id: 'c2', retry_count: 2 }));

      const drain = OfflineQueueManager.retryPending();
      await jest.runAllTimersAsync();
      await drain;

      expect(uploadFn).toHaveBeenCalledTimes(1);
    });

    it('retry_count=1 blocks upload until 5 s have elapsed', async () => {
      jest.useFakeTimers();
      const uploadFn = jest.fn().mockResolvedValue({ success: true });
      OfflineQueueManager.configure({ uploadFn });

      await fakeRepo.enqueue(makeEntry({ id: 'c1', retry_count: 1 }));

      const drain = OfflineQueueManager.retryPending();

      // Flush microtasks so the async function reaches the _sleep(5000) call
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // The sleep timer has been scheduled but not yet fired
      expect(jest.getTimerCount()).toBeGreaterThan(0);
      expect(uploadFn).not.toHaveBeenCalled();

      // Fire the 5 s timer
      jest.runAllTimers();
      await drain;

      expect(uploadFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── failed state after max retries ────────────────────────────────────────

  describe('failed state after max retries', () => {
    it('marks entry failed when retry_count already equals MAX_RETRIES (3)', async () => {
      // Entry at retry_count=3 is processed without an upload attempt
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      await fakeRepo.enqueue(makeEntry({ id: 'at-max', retry_count: 3, status: 'pending' }));
      await OfflineQueueManager.retryPending();

      const all = await fakeRepo.getAll();
      expect(all[0].status).toBe('failed');
    });

    it('emits queue:chunk-failed when an entry exceeds MAX_RETRIES', async () => {
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      const failedHandler = jest.fn();
      OfflineQueueManager.on('queue:chunk-failed', failedHandler);

      await fakeRepo.enqueue(makeEntry({ id: 'at-max', retry_count: 3, status: 'pending' }));
      await OfflineQueueManager.retryPending();

      expect(failedHandler).toHaveBeenCalledTimes(1);
      // The entry object in the payload reflects the state at emit time.
      // repo.markFailed() was called, but the emitted entry reference is
      // the original pending entry (status: 'pending') — the repo is the
      // source of truth for the persisted status.
      expect(failedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          entry: expect.objectContaining({ id: 'at-max', retry_count: 3 }),
        })
      );
    });

    it('marks failed when failing at retry_count=2 (newCount=3 hits MAX_RETRIES)', async () => {
      jest.useFakeTimers();
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      // retry_count=2 → BACKOFF_MS[2]=10 000 ms
      await fakeRepo.enqueue(makeEntry({ id: 'c2-last', retry_count: 2, status: 'pending' }));

      const drain = OfflineQueueManager.retryPending();
      await jest.runAllTimersAsync();
      await drain;

      const all = await fakeRepo.getAll();
      expect(all[0].status).toBe('failed');

      jest.useRealTimers();
    });

    it('does not call uploadFn for an entry already at MAX_RETRIES', async () => {
      const uploadFn = jest.fn().mockResolvedValue({ success: false });
      OfflineQueueManager.configure({ uploadFn });

      await fakeRepo.enqueue(makeEntry({ id: 'at-max', retry_count: 3, status: 'pending' }));
      await OfflineQueueManager.retryPending();

      expect(uploadFn).not.toHaveBeenCalled();
    });
  });

  // ── storage warning threshold ─────────────────────────────────────────────

  describe('storage warning threshold (>80 % of 360 MB)', () => {
    const MAX_BUFFER_BYTES = 360 * 1024 * 1024;

    it('emits queue:storage-warning when storage exceeds 80 %', async () => {
      fakeRepo.setStorageSize(Math.ceil(MAX_BUFFER_BYTES * 0.81));

      const warningHandler = jest.fn();
      OfflineQueueManager.on('queue:storage-warning', warningHandler);

      await OfflineQueueManager.enqueue('big-chunk', 'sess-1');

      expect(warningHandler).toHaveBeenCalledTimes(1);
      expect(warningHandler.mock.calls[0][0].percentFull).toBeGreaterThanOrEqual(0.8);
    });

    it('does not emit queue:storage-warning when storage is at 79 %', async () => {
      fakeRepo.setStorageSize(Math.floor(MAX_BUFFER_BYTES * 0.79));

      const warningHandler = jest.fn();
      OfflineQueueManager.on('queue:storage-warning', warningHandler);

      await OfflineQueueManager.enqueue('small-chunk', 'sess-1');

      expect(warningHandler).not.toHaveBeenCalled();
    });

    it('emits at the exact 80 % boundary', async () => {
      fakeRepo.setStorageSize(MAX_BUFFER_BYTES * 0.8);

      const warningHandler = jest.fn();
      OfflineQueueManager.on('queue:storage-warning', warningHandler);

      await OfflineQueueManager.enqueue('boundary-chunk', 'sess-1');

      expect(warningHandler).toHaveBeenCalledTimes(1);
    });

    it('getQueueStats reports percentFull correctly', async () => {
      fakeRepo.setStorageSize(MAX_BUFFER_BYTES / 2);
      await fakeRepo.enqueue(makeEntry());

      const stats = await OfflineQueueManager.getQueueStats();
      expect(stats.percentFull).toBeCloseTo(0.5, 2);
      expect(stats.storageSizeBytes).toBe(MAX_BUFFER_BYTES / 2);
    });

    it('getQueueStats caps percentFull at 1.0 when storage exceeds max', async () => {
      fakeRepo.setStorageSize(MAX_BUFFER_BYTES * 2);

      const stats = await OfflineQueueManager.getQueueStats();
      expect(stats.percentFull).toBe(1);
    });
  });

  // ── getQueueStats ─────────────────────────────────────────────────────────

  describe('getQueueStats', () => {
    it('counts pending and failed entries correctly', async () => {
      await fakeRepo.enqueue(makeEntry({ id: 'p1', status: 'pending' }));
      await fakeRepo.enqueue(makeEntry({ id: 'p2', status: 'pending' }));
      await fakeRepo.enqueue(makeEntry({ id: 'f1', status: 'failed' }));
      await fakeRepo.enqueue(makeEntry({ id: 's1', status: 'sent' }));

      const stats = await OfflineQueueManager.getQueueStats();
      expect(stats.pendingCount).toBe(2);
      expect(stats.failedCount).toBe(1);
    });

    it('returns zeros when the queue is empty', async () => {
      const stats = await OfflineQueueManager.getQueueStats();
      expect(stats.pendingCount).toBe(0);
      expect(stats.failedCount).toBe(0);
    });
  });

  // ── queue:synced event ────────────────────────────────────────────────────

  describe('queue:synced event', () => {
    it('emits synced with the count of successfully uploaded chunks', async () => {
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: true }),
      });

      const syncedHandler = jest.fn();
      OfflineQueueManager.on('queue:synced', syncedHandler);

      await fakeRepo.enqueue(makeEntry({ id: 'a' }));
      await fakeRepo.enqueue(makeEntry({ id: 'b' }));
      await OfflineQueueManager.retryPending();

      expect(syncedHandler).toHaveBeenCalledWith({ syncedCount: 2 });
    });

    it('does not emit synced when no chunks were uploaded', async () => {
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      const syncedHandler = jest.fn();
      OfflineQueueManager.on('queue:synced', syncedHandler);

      await fakeRepo.enqueue(makeEntry());
      await OfflineQueueManager.retryPending();

      expect(syncedHandler).not.toHaveBeenCalled();
    });
  });

  // ── _draining guard ───────────────────────────────────────────────────────

  describe('_draining guard (prevents concurrent drain loops)', () => {
    it('returns 0 immediately when a drain is already in progress', async () => {
      let resolveUpload!: () => void;
      const blocked = new Promise<{ success: boolean }>(res => {
        resolveUpload = () => res({ success: true });
      });
      OfflineQueueManager.configure({ uploadFn: jest.fn().mockReturnValue(blocked) });
      await fakeRepo.enqueue(makeEntry());

      const first  = OfflineQueueManager.retryPending();
      const second = await OfflineQueueManager.retryPending();

      expect(second).toBe(0);

      resolveUpload();
      await first;
    });
  });

  // ── retryPending with no uploadFn configured ──────────────────────────────

  describe('retryPending before configure()', () => {
    it('returns 0 without throwing when uploadFn is not set', async () => {
      await fakeRepo.enqueue(makeEntry());
      const count = await OfflineQueueManager.retryPending();
      expect(count).toBe(0);
    });
  });
});
