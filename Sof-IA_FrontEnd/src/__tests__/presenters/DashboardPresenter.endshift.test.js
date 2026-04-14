/**
 * DashboardPresenter — End Shift flow tests
 *
 * Tests the complete dialog state machine driven by the presenter.
 * All external services are mocked — no DB, no network, no RN rendering.
 */

// ─── React Native mock (extends global jest.setup.js mock with AppState) ──────

jest.mock('react-native', () => ({
  Platform: { OS: 'web', select: jest.fn((obj) => obj.web || obj.default) },
  StyleSheet: { create: (s) => s },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

// ─── Service / dependency mocks ────────────────────────────────────────────────

jest.mock('../../services/EndShiftService', () => ({
  __esModule: true,
  default: {
    flushQueue: jest.fn(),
    run: jest.fn(),
  },
}));

jest.mock('../../services/SessionService', () => ({
  __esModule: true,
  default: {
    getActiveSessionId: jest.fn(),
    clearCache: jest.fn(),
  },
}));

jest.mock('../../services/audio/AudioSourceResolver', () => ({
  default: {
    resolve: jest.fn().mockResolvedValue({ getSourceKey: () => 'builtin', getSourceLabel: () => 'Built-in mic' }),
    getAvailableSources: jest.fn().mockResolvedValue([]),
    toggle: jest.fn(),
    resetOverride: jest.fn(),
  },
}));

jest.mock('../../services/PermissionsService', () => ({
  default: {
    check: jest.fn().mockResolvedValue('granted'),
    ensure: jest.fn().mockResolvedValue('granted'),
    request: jest.fn().mockResolvedValue('granted'),
    openSettings: jest.fn(),
  },
}));

jest.mock('../../repositories', () => ({
  getStorage: jest.fn().mockResolvedValue({
    queryBySession: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    bulkDelete: jest.fn().mockResolvedValue(0),
  }),
}));

// ─── Subject under test ────────────────────────────────────────────────────────

import DashboardPresenter from '../../presenters/DashboardPresenter';
import EndShiftService from '../../services/EndShiftService';
import SessionService from '../../services/SessionService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeView() {
  return {
    setAudioSource: jest.fn(),
    setMicStatus: jest.fn(),
    setRecording: jest.fn(),
    setBeds: jest.fn(),
    setBedsLoading: jest.fn(),
    setConfirmVisible: jest.fn(),
    setFlushSyncing: jest.fn(),
    setOfflineGateVisible: jest.fn(),
    setCleanupProgress: jest.fn(),
    setCleanupResult: jest.fn(),
  };
}

function makeNavigation() {
  return { reset: jest.fn(), navigate: jest.fn(), goBack: jest.fn() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardPresenter — end shift flow', () => {
  let presenter;
  let view;
  let navigation;

  beforeEach(() => {
    jest.clearAllMocks();
    view = makeView();
    navigation = makeNavigation();
    presenter = new DashboardPresenter(view);
    SessionService.getActiveSessionId.mockResolvedValue('session_test_123');
  });

  // ── Step 1: button tap ────────────────────────────────────────────────────

  describe('onEndShift', () => {
    it('opens the confirmation dialog', () => {
      presenter.onEndShift(navigation);
      expect(view.setConfirmVisible).toHaveBeenCalledWith(true);
    });
  });

  // ── Step 2: cancel ────────────────────────────────────────────────────────

  describe('onEndShiftCancel', () => {
    it('closes the confirmation dialog', () => {
      presenter.onEndShiftCancel();
      expect(view.setConfirmVisible).toHaveBeenCalledWith(false);
    });
  });

  // ── Step 3: confirm → flush succeeds ──────────────────────────────────────

  describe('onEndShiftConfirmed — queue empty', () => {
    beforeEach(() => {
      EndShiftService.flushQueue.mockResolvedValue({ success: true, pendingCount: 0 });
      EndShiftService.run.mockResolvedValue({ success: true, failedItems: [], durationMs: 80 });
    });

    it('dismisses confirm dialog', async () => {
      await presenter.onEndShiftConfirmed(navigation);
      expect(view.setConfirmVisible).toHaveBeenCalledWith(false);
    });

    it('shows then hides the syncing overlay', async () => {
      await presenter.onEndShiftConfirmed(navigation);
      expect(view.setFlushSyncing).toHaveBeenCalledWith(true);
      expect(view.setFlushSyncing).toHaveBeenCalledWith(false);
    });

    it('skips the offline gate', async () => {
      await presenter.onEndShiftConfirmed(navigation);
      expect(view.setOfflineGateVisible).not.toHaveBeenCalledWith(true);
    });

    it('shows then hides the progress overlay', async () => {
      await presenter.onEndShiftConfirmed(navigation);
      expect(view.setCleanupProgress).toHaveBeenCalledWith(true);
      expect(view.setCleanupProgress).toHaveBeenCalledWith(false);
    });

    it('sets a success cleanupResult', async () => {
      await presenter.onEndShiftConfirmed(navigation);
      expect(view.setCleanupResult).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, failedItems: [] })
      );
    });

    it('includes a timestamp in the result', async () => {
      await presenter.onEndShiftConfirmed(navigation);
      const result = view.setCleanupResult.mock.calls[0][0];
      expect(result.timestamp).toBeTruthy();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });
  });

  // ── Step 3: confirm → flush fails (offline) ───────────────────────────────

  describe('onEndShiftConfirmed — offline', () => {
    beforeEach(() => {
      EndShiftService.flushQueue.mockResolvedValue({ success: false, pendingCount: 2 });
    });

    it('shows the offline gate', async () => {
      await presenter.onEndShiftConfirmed(navigation);
      expect(view.setOfflineGateVisible).toHaveBeenCalledWith(true);
    });

    it('does NOT start cleanup', async () => {
      await presenter.onEndShiftConfirmed(navigation);
      expect(view.setCleanupProgress).not.toHaveBeenCalled();
      expect(EndShiftService.run).not.toHaveBeenCalled();
    });
  });

  // ── Step 4a: offline gate → wait ──────────────────────────────────────────

  describe('onOfflineGateWait', () => {
    it('closes the offline gate without starting cleanup', () => {
      presenter.onOfflineGateWait();
      expect(view.setOfflineGateVisible).toHaveBeenCalledWith(false);
      expect(EndShiftService.run).not.toHaveBeenCalled();
    });
  });

  // ── Step 4b: offline gate → force delete ─────────────────────────────────

  describe('onOfflineGateForceDelete', () => {
    beforeEach(() => {
      EndShiftService.run.mockResolvedValue({ success: true, failedItems: [], durationMs: 100 });
    });

    it('closes the offline gate', async () => {
      await presenter.onOfflineGateForceDelete(navigation);
      expect(view.setOfflineGateVisible).toHaveBeenCalledWith(false);
    });

    it('runs cleanup', async () => {
      await presenter.onOfflineGateForceDelete(navigation);
      expect(EndShiftService.run).toHaveBeenCalled();
    });

    it('sets a success result', async () => {
      await presenter.onOfflineGateForceDelete(navigation);
      expect(view.setCleanupResult).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });

  // ── Step 5: success → dismiss (navigation) ────────────────────────────────

  describe('onSuccessDismiss', () => {
    it('clears the result state', () => {
      presenter.onSuccessDismiss(navigation);
      expect(view.setCleanupResult).toHaveBeenCalledWith(null);
    });

    it('resets the navigation stack to ModeSelection', () => {
      presenter.onSuccessDismiss(navigation);
      expect(navigation.reset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: 'ModeSelection' }],
      });
    });

    it('resets recording state if a recording was in progress', () => {
      presenter._isRecording = true;
      presenter.onSuccessDismiss(navigation);
      expect(view.setRecording).toHaveBeenCalledWith(false);
      expect(presenter._isRecording).toBe(false);
    });

    it('does not call setRecording when not recording', () => {
      presenter._isRecording = false;
      presenter.onSuccessDismiss(navigation);
      expect(view.setRecording).not.toHaveBeenCalled();
    });
  });

  // ── Step 5: error → dismiss ───────────────────────────────────────────────

  describe('onCleanupErrorDismiss', () => {
    it('clears the result state without navigating', () => {
      presenter.onCleanupErrorDismiss();
      expect(view.setCleanupResult).toHaveBeenCalledWith(null);
      expect(navigation.reset).not.toHaveBeenCalled();
    });
  });

  // ── Step 5: error → retry ─────────────────────────────────────────────────

  describe('onRetryCleanup', () => {
    beforeEach(() => {
      EndShiftService.run.mockResolvedValue({ success: true, failedItems: [], durationMs: 50 });
    });

    it('clears previous result before retrying', async () => {
      await presenter.onRetryCleanup(navigation);
      expect(view.setCleanupResult).toHaveBeenCalledWith(null);
    });

    it('runs cleanup again', async () => {
      await presenter.onRetryCleanup(navigation);
      expect(EndShiftService.run).toHaveBeenCalled();
    });

    it('sets a new result after retry', async () => {
      await presenter.onRetryCleanup(navigation);
      const calls = view.setCleanupResult.mock.calls;
      // First call: null (clear), second call: new result
      expect(calls[0][0]).toBeNull();
      expect(calls[1][0]).toMatchObject({ success: true });
    });
  });

  // ── Full happy-path sequence ───────────────────────────────────────────────

  describe('full happy-path sequence', () => {
    it('walks through all state transitions in order', async () => {
      EndShiftService.flushQueue.mockResolvedValue({ success: true, pendingCount: 0 });
      EndShiftService.run.mockResolvedValue({ success: true, failedItems: [], durationMs: 120 });

      // 1. Tap button
      presenter.onEndShift(navigation);
      expect(view.setConfirmVisible).toHaveBeenCalledWith(true);

      // 2. Confirm
      await presenter.onEndShiftConfirmed(navigation);

      // Syncing shown / hidden
      expect(view.setFlushSyncing).toHaveBeenNthCalledWith(1, true);
      expect(view.setFlushSyncing).toHaveBeenNthCalledWith(2, false);

      // No offline gate
      expect(view.setOfflineGateVisible).not.toHaveBeenCalledWith(true);

      // Progress shown / hidden
      expect(view.setCleanupProgress).toHaveBeenNthCalledWith(1, true);
      expect(view.setCleanupProgress).toHaveBeenNthCalledWith(2, false);

      // Success result
      const result = view.setCleanupResult.mock.calls.find((c) => c[0] !== null)?.[0];
      expect(result).toMatchObject({ success: true, failedItems: [] });

      // 3. Dismiss → navigate
      presenter.onSuccessDismiss(navigation);
      expect(navigation.reset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: 'ModeSelection' }],
      });
    });
  });
});
