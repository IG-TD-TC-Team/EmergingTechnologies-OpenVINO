/**
 * Shift-end gate — integration tests
 *
 * Tests the presenter's end-shift flow using the real OfflineQueueManager
 * (backed by a fake in-memory repository) rather than a mock, so that
 * the actual retryPending() + getQueueStats() contract is exercised.
 *
 * Covered scenarios:
 *   1. Queue non-empty after retry → offline gate modal shown with correct count
 *   2. Force delete → EndShiftService.run() is called (wipe proceeds)
 *   3. Queue drained successfully → cleanup runs without showing gate
 *   4. Mixed pending+failed counts → gate shows the combined total
 */

// ─── React Native mock ────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  Platform: { OS: 'web', select: jest.fn((obj) => obj.web || obj.default) },
  StyleSheet: { create: (s: object) => s },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

// ─── Service mocks ────────────────────────────────────────────────────────────

// Real OfflineQueueManager — backed by fake repo injected via getOfflineQueueRepository
jest.mock('../../services/queue/index', () => ({
  getOfflineQueueRepository: jest.fn(),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => `uuid-${Date.now()}`) }));

jest.mock('../../services/EndShiftService', () => ({
  __esModule: true,
  default: {
    flushQueue: jest.fn(),
    run:        jest.fn(),
  },
}));

jest.mock('../../services/SessionService', () => ({
  __esModule: true,
  default: {
    getActiveSessionId: jest.fn().mockResolvedValue('sess-gate-test'),
    clearCache:         jest.fn(),
  },
}));

jest.mock('../../services/audio/AudioSourceResolver', () => ({
  default: {
    resolve:           jest.fn().mockResolvedValue({ getSourceKey: () => 'builtin', getSourceLabel: () => 'Built-in' }),
    getAvailableSources: jest.fn().mockResolvedValue([]),
    resetOverride:     jest.fn(),
  },
}));

jest.mock('../../services/PermissionsService', () => ({
  default: {
    check:   jest.fn().mockResolvedValue('granted'),
    ensure:  jest.fn().mockResolvedValue('granted'),
    request: jest.fn().mockResolvedValue('granted'),
    openSettings: jest.fn(),
  },
}));

jest.mock('../../services/audio/ContinuousRecordingService', () => ({
  __esModule: true,
  default: {
    subscribe:        jest.fn(() => jest.fn()),
    initialize:       jest.fn().mockResolvedValue(undefined),
    isRecording:      jest.fn().mockReturnValue(false),
    getSessionId:     jest.fn().mockReturnValue(null),
    toggleRecording:  jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/audio/WebRecorderService', () => ({
  default: { isSupported: jest.fn().mockReturnValue(false) },
}));

jest.mock('../../services/audio/ServiceWorkerManager', () => ({
  default: { register: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../repositories', () => ({
  getStorage: jest.fn().mockResolvedValue({
    queryBySession: jest.fn().mockResolvedValue([]),
    create:         jest.fn(),
  }),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import DashboardPresenter from '../../presenters/DashboardPresenter';
import EndShiftService from '../../services/EndShiftService';
import OfflineQueueManager from '../../services/queue/OfflineQueueManager';
import { getOfflineQueueRepository } from '../../services/queue/index';
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
    async getAll()            { return [...store.values()]; },
    async deleteEntry(id)     { store.delete(id); },
    async getStorageSizeBytes() { return 0; },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<OfflineQueueEntry> = {}): OfflineQueueEntry {
  return {
    id:          `entry-${Math.random()}`,
    chunk_ref:   'ref-default',
    session_id:  'sess-gate-test',
    timestamp:   new Date().toISOString(),
    retry_count: 0,
    status:      'pending',
    ...overrides,
  };
}

function makeView() {
  return {
    setAudioSource:        jest.fn(),
    setMicStatus:          jest.fn(),
    setRecording:          jest.fn(),
    setConnectionStatus:   jest.fn(),
    setBeds:               jest.fn(),
    setBedsLoading:        jest.fn(),
    setConfirmVisible:     jest.fn(),
    setFlushSyncing:       jest.fn(),
    setOfflineGateVisible: jest.fn(),
    setUnsyncedCount:      jest.fn(),
    setCleanupProgress:    jest.fn(),
    setCleanupResult:      jest.fn(),
    setActivePatient:      jest.fn(),
    setBrowserSupported:   jest.fn(),
    setTranscriptionSegments: jest.fn(),
  };
}

function makeNavigation() {
  return { reset: jest.fn(), navigate: jest.fn(), goBack: jest.fn() };
}

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

describe('Shift-end gate — integration', () => {
  let fakeRepo: IOfflineQueueRepository;
  let view:     ReturnType<typeof makeView>;
  let nav:      ReturnType<typeof makeNavigation>;
  let presenter: DashboardPresenter;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeRepo = makeFakeRepo();
    (getOfflineQueueRepository as jest.Mock).mockResolvedValue(fakeRepo);
    resetManager();

    view       = makeView();
    nav        = makeNavigation();
    presenter  = new DashboardPresenter(view);

    (EndShiftService.run as jest.Mock).mockResolvedValue({
      success: true, failedItems: [], durationMs: 50,
    });
  });

  // ── queue non-empty → gate shown ─────────────────────────────────────────

  describe('queue non-empty → offline gate modal shown', () => {
    it('shows the gate modal when pending chunks remain after retry', async () => {
      // Chunks at retry_count=0 → BACKOFF_MS[0]=0 (no delay)
      // Upload fails → retry_count becomes 1 (still pending)
      await fakeRepo.enqueue(makeEntry({ id: 'c1' }));
      await fakeRepo.enqueue(makeEntry({ id: 'c2' }));

      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      await presenter.onEndShiftConfirmed(nav);

      expect(view.setOfflineGateVisible).toHaveBeenCalledWith(true);
    });

    it('passes the exact unsynced count to the view', async () => {
      await fakeRepo.enqueue(makeEntry({ id: 'c1' }));
      await fakeRepo.enqueue(makeEntry({ id: 'c2' }));
      await fakeRepo.enqueue(makeEntry({ id: 'c3' }));

      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      await presenter.onEndShiftConfirmed(nav);

      // After retry, all 3 are still pending (retry_count 0→1)
      expect(view.setUnsyncedCount).toHaveBeenCalledWith(3);
    });

    it('counts both pending AND failed entries in the unsynced total', async () => {
      // 2 pending + 1 already failed
      await fakeRepo.enqueue(makeEntry({ id: 'p1', retry_count: 0 }));
      await fakeRepo.enqueue(makeEntry({ id: 'p2', retry_count: 0 }));
      await fakeRepo.enqueue(makeEntry({ id: 'f1', retry_count: 3, status: 'failed' }));

      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      await presenter.onEndShiftConfirmed(nav);

      // p1 and p2: retry_count 0→1 (still pending)
      // f1: already failed (not in getPending(), so not retried)
      // Total: 2 pending + 1 failed = 3
      expect(view.setUnsyncedCount).toHaveBeenCalledWith(3);
    });

    it('does NOT start cleanup while the gate is open', async () => {
      await fakeRepo.enqueue(makeEntry({ id: 'c1' }));
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      await presenter.onEndShiftConfirmed(nav);

      expect(view.setCleanupProgress).not.toHaveBeenCalled();
      expect(EndShiftService.run).not.toHaveBeenCalled();
    });
  });

  // ── gate: wait ────────────────────────────────────────────────────────────

  describe('gate: nurse taps Wait', () => {
    it('closes the gate without triggering cleanup', async () => {
      await fakeRepo.enqueue(makeEntry({ id: 'c1' }));
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      await presenter.onEndShiftConfirmed(nav);
      presenter.onOfflineGateWait();

      expect(view.setOfflineGateVisible).toHaveBeenCalledWith(false);
      expect(EndShiftService.run).not.toHaveBeenCalled();
    });
  });

  // ── gate: force delete → wipe proceeds ───────────────────────────────────

  describe('gate: nurse taps Force delete', () => {
    it('closes the gate and runs EndShiftService.run()', async () => {
      await fakeRepo.enqueue(makeEntry({ id: 'c1' }));
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      await presenter.onEndShiftConfirmed(nav);
      await presenter.onOfflineGateForceDelete(nav);

      expect(view.setOfflineGateVisible).toHaveBeenCalledWith(false);
      expect(EndShiftService.run).toHaveBeenCalled();
    });

    it('sets a success cleanup result after force-delete', async () => {
      await fakeRepo.enqueue(makeEntry({ id: 'c1' }));
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      await presenter.onEndShiftConfirmed(nav);
      await presenter.onOfflineGateForceDelete(nav);

      expect(view.setCleanupResult).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, failedItems: [] })
      );
    });
  });

  // ── queue empty → gate skipped ────────────────────────────────────────────

  describe('queue already empty → gate not shown', () => {
    it('proceeds directly to cleanup when the queue is empty', async () => {
      // No entries in queue
      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: true }),
      });

      await presenter.onEndShiftConfirmed(nav);

      expect(view.setOfflineGateVisible).not.toHaveBeenCalledWith(true);
      expect(EndShiftService.run).toHaveBeenCalled();
    });

    it('marks all pending entries sent and proceeds without gate', async () => {
      await fakeRepo.enqueue(makeEntry({ id: 'c1' }));

      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: true }),
      });

      await presenter.onEndShiftConfirmed(nav);

      expect(view.setOfflineGateVisible).not.toHaveBeenCalledWith(true);
      expect(EndShiftService.run).toHaveBeenCalled();
    });
  });

  // ── full gate sequence ────────────────────────────────────────────────────

  describe('full gate sequence: chunks remain → force delete → success', () => {
    it('walks through all state transitions correctly', async () => {
      await fakeRepo.enqueue(makeEntry({ id: 'c1' }));
      await fakeRepo.enqueue(makeEntry({ id: 'c2' }));

      OfflineQueueManager.configure({
        uploadFn: jest.fn().mockResolvedValue({ success: false }),
      });

      // 1. Confirm end shift
      await presenter.onEndShiftConfirmed(nav);

      // Syncing overlay shown and hidden
      expect(view.setFlushSyncing).toHaveBeenNthCalledWith(1, true);
      expect(view.setFlushSyncing).toHaveBeenNthCalledWith(2, false);

      // Gate shown with count=2
      expect(view.setOfflineGateVisible).toHaveBeenCalledWith(true);
      expect(view.setUnsyncedCount).toHaveBeenCalledWith(2);

      // No cleanup yet
      expect(EndShiftService.run).not.toHaveBeenCalled();

      // 2. Nurse force-deletes
      await presenter.onOfflineGateForceDelete(nav);

      // Gate closed, cleanup ran, result set
      expect(view.setOfflineGateVisible).toHaveBeenCalledWith(false);
      expect(view.setCleanupProgress).toHaveBeenCalledWith(true);
      expect(view.setCleanupProgress).toHaveBeenCalledWith(false);
      expect(view.setCleanupResult).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });
});
