/**
 * DashboardPresenter — US23: Recording auto-resume on app relaunch
 *
 * Tests:
 *   - _maybeResumeRecording with WAS_RECORDING=true + granted → auto-starts recording
 *   - _maybeResumeRecording with WAS_RECORDING=false → no auto-start
 *   - _maybeResumeRecording with WAS_RECORDING missing → no auto-start
 *   - _maybeResumeRecording with permission denied → no auto-start
 *   - onMicPress start → persists WAS_RECORDING=true
 *   - onMicPress stop  → persists WAS_RECORDING=false
 *   - onSuccessDismiss → clears WAS_RECORDING
 */

// ─── React Native mock ────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  Platform: { OS: 'web', select: jest.fn((obj) => obj.web || obj.default) },
  StyleSheet: { create: (s) => s },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

// ─── Service mocks ────────────────────────────────────────────────────────────

jest.mock('../../services/EndShiftService', () => ({
  __esModule: true,
  default: { flushQueue: jest.fn(), run: jest.fn() },
}));

jest.mock('../../services/SessionService', () => ({
  __esModule: true,
  default: {
    getActiveSessionId: jest.fn(),
    clearCache: jest.fn(),
  },
}));

jest.mock('../../services/audio/AudioSourceResolver', () => ({
  __esModule: true,
  default: {
    resolve: jest.fn(),
    getAvailableSources: jest.fn(),
    toggle: jest.fn(),
    resetOverride: jest.fn(),
  },
}));

jest.mock('../../services/audio/WebRecorderService', () => ({
  __esModule: true,
  default: {
    isSupported: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  },
}));

jest.mock('../../services/audio/ServiceWorkerManager', () => ({
  __esModule: true,
  default: { register: jest.fn() },
}));

jest.mock('../../services/PermissionsService', () => ({
  __esModule: true,
  default: {
    check: jest.fn(),
    ensure: jest.fn(),
    request: jest.fn(),
    openSettings: jest.fn(),
  },
}));

jest.mock('../../repositories', () => ({
  getStorage: jest.fn().mockResolvedValue({
    queryBySession: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(null),
    bulkDelete: jest.fn().mockResolvedValue(0),
  }),
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import DashboardPresenter from '../../presenters/DashboardPresenter';
import PermissionsService from '../../services/PermissionsService';
import SessionService from '../../services/SessionService';
import EndShiftService from '../../services/EndShiftService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WebRecorderService from '../../services/audio/WebRecorderService';

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
    setActivePatient: jest.fn(),
    setBrowserSupported: jest.fn(),
  };
}

function makeNavigation() {
  return { reset: jest.fn(), navigate: jest.fn(), goBack: jest.fn() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardPresenter — US23 recording auto-resume', () => {
  let view;
  let navigation;

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-apply implementations after clearAllMocks
    PermissionsService.check.mockResolvedValue('granted');
    PermissionsService.ensure.mockResolvedValue('granted');
    SessionService.getActiveSessionId.mockResolvedValue('session_test');
    WebRecorderService.isSupported.mockReturnValue(false);
    WebRecorderService.start.mockResolvedValue(undefined);
    AsyncStorage.getItem.mockResolvedValue(null);
    AsyncStorage.setItem.mockResolvedValue(undefined);
  });

  // ── _maybeResumeRecording ─────────────────────────────────────────────────

  describe('_maybeResumeRecording()', () => {
    it('auto-starts recording when WAS_RECORDING=true and permission granted', async () => {
      AsyncStorage.getItem.mockResolvedValue('true');
      view = makeView();
      const presenter = new DashboardPresenter(view);
      await presenter._maybeResumeRecording();
      expect(view.setRecording).toHaveBeenCalledWith(true);
      expect(presenter._isRecording).toBe(true);
    });

    it('does NOT auto-start when WAS_RECORDING=false', async () => {
      AsyncStorage.getItem.mockResolvedValue('false');
      view = makeView();
      const presenter = new DashboardPresenter(view);
      await presenter._maybeResumeRecording();
      expect(view.setRecording).not.toHaveBeenCalled();
      expect(presenter._isRecording).toBe(false);
    });

    it('does NOT auto-start when WAS_RECORDING is absent', async () => {
      AsyncStorage.getItem.mockResolvedValue(null);
      view = makeView();
      const presenter = new DashboardPresenter(view);
      await presenter._maybeResumeRecording();
      expect(view.setRecording).not.toHaveBeenCalled();
    });

    it('does NOT auto-start when permission is denied', async () => {
      AsyncStorage.getItem.mockResolvedValue('true');
      PermissionsService.check.mockResolvedValue('denied');
      view = makeView();
      const presenter = new DashboardPresenter(view);
      await presenter._maybeResumeRecording();
      expect(view.setRecording).not.toHaveBeenCalled();
      expect(presenter._isRecording).toBe(false);
    });

    it('persists WAS_RECORDING=true after auto-resuming', async () => {
      AsyncStorage.getItem.mockResolvedValue('true');
      view = makeView();
      const presenter = new DashboardPresenter(view);
      await presenter._maybeResumeRecording();
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('was_recording', 'true');
    });
  });

  // ── onMicPress — recording state persistence ──────────────────────────────

  describe('onMicPress — recording state persistence', () => {
    it('saves WAS_RECORDING=true when recording starts', async () => {
      view = makeView();
      const presenter = new DashboardPresenter(view);
      await presenter.onMicPress();
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('was_recording', 'true');
    });

    it('saves WAS_RECORDING=false when recording stops', async () => {
      view = makeView();
      const presenter = new DashboardPresenter(view);
      presenter._isRecording = true;
      await presenter.onMicPress();
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('was_recording', 'false');
    });
  });

  // ── onSuccessDismiss — clears flag on shift end ───────────────────────────

  describe('onSuccessDismiss', () => {
    it('clears WAS_RECORDING when shift ends', () => {
      EndShiftService.run.mockResolvedValue({ success: true, failedItems: [], durationMs: 50 });
      view = makeView();
      navigation = makeNavigation();
      const presenter = new DashboardPresenter(view);
      presenter.onSuccessDismiss(navigation);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('was_recording', 'false');
    });

    it('does not leave WAS_RECORDING=true if recording was active on shift end', () => {
      view = makeView();
      navigation = makeNavigation();
      const presenter = new DashboardPresenter(view);
      presenter._isRecording = true;
      presenter.onSuccessDismiss(navigation);
      const lastCall = AsyncStorage.setItem.mock.calls.find(
        ([key]) => key === 'was_recording'
      );
      expect(lastCall[1]).toBe('false');
    });
  });
});