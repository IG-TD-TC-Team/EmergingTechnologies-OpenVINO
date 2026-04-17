
/**
 * DashboardPresenter — US23: Automatic shift resume
 *
 * Tests:
 *   - mount(true)  + recording was active  → auto-resumes recording + shows banner
 *   - mount(true)  + recording not active  → shows banner only (no recording start)
 *   - mount(true)  + no active session     → shows banner, skips recording check
 *   - mount(false) (default)               → no banner, no recording start
 *   - onMicPress start                     → persists recording state ON
 *   - onMicPress stop                      → persists recording state OFF
 *   - onDismissResumeBanner                → hides the banner
 *   - _proceedWithCleanup (via onOfflineGateForceDelete) → clears recording state
 */

// ─── React Native mock ────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
  Platform: { OS: 'web', select: jest.fn((obj) => obj.web || obj.default) },
  StyleSheet: { create: (s) => s },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

// ─── Service / dependency mocks ───────────────────────────────────────────────

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
    getRecordingActive: jest.fn(),
    setRecordingActive: jest.fn(),
    clearCache: jest.fn(),
  },
}));

jest.mock('../../services/audio/AudioSourceResolver', () => ({
  __esModule: true,
  default: {
    resolve: jest.fn().mockResolvedValue({
      getSourceKey: () => 'builtin',
      getSourceLabel: () => 'Built-in mic',
    }),
    getAvailableSources: jest.fn().mockResolvedValue([]),
    toggle: jest.fn(),
    resetOverride: jest.fn(),
  },
}));

jest.mock('../../services/PermissionsService', () => ({
  __esModule: true,
  default: {
    check: jest.fn().mockResolvedValue('granted'),
    ensure: jest.fn().mockResolvedValue('granted'),
    request: jest.fn(),
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

// WebRecorderService: controlled by each test via mockReturnValue
jest.mock('../../services/audio/WebRecorderService', () => ({
  __esModule: true,
  default: {
    isSupported: jest.fn(),
    isRecording: jest.fn().mockReturnValue(false),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
  },
}));

jest.mock('../../services/audio/ServiceWorkerManager', () => ({
  __esModule: true,
  default: {
    register: jest.fn().mockResolvedValue(undefined),
    requestSync: jest.fn().mockResolvedValue(undefined),
  },
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import DashboardPresenter from '../../presenters/DashboardPresenter';
import SessionService from '../../services/SessionService';
import EndShiftService from '../../services/EndShiftService';
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
    setResumeBannerVisible: jest.fn(),
  };
}

function makeNavigation() {
  return { reset: jest.fn(), navigate: jest.fn(), goBack: jest.fn() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardPresenter — US23 shift resume', () => {
  let presenter;
  let view;
  let navigation;

  afterEach(() => {
    presenter.unmount(); // clears the polling interval started by mount()
  });

  beforeEach(() => {
    jest.clearAllMocks();

    SessionService.getActiveSessionId.mockResolvedValue('session_test_123');
    SessionService.getRecordingActive.mockResolvedValue(false);
    SessionService.setRecordingActive.mockResolvedValue(undefined);

    WebRecorderService.isSupported.mockReturnValue(true);

    view = makeView();
    navigation = makeNavigation();
    presenter = new DashboardPresenter(view);
  });

  // ── mount(true) — recording was active ────────────────────────────────────

  describe('mount(true) — recording was active', () => {
    beforeEach(() => {
      SessionService.getRecordingActive.mockResolvedValue(true);
    });

    it('shows the resume banner', async () => {
      await presenter.mount(true);
      expect(view.setResumeBannerVisible).toHaveBeenCalledWith(true);
    });

    it('starts the web recorder with the active session ID', async () => {
      await presenter.mount(true);
      expect(WebRecorderService.start).toHaveBeenCalledWith('session_test_123');
    });

    it('sets recording state to true', async () => {
      await presenter.mount(true);
      expect(view.setRecording).toHaveBeenCalledWith(true);
      expect(presenter._isRecording).toBe(true);
    });
  });

  // ── mount(true) — recording was NOT active ────────────────────────────────

  describe('mount(true) — recording was not active', () => {
    beforeEach(() => {
      SessionService.getRecordingActive.mockResolvedValue(false);
    });

    it('shows the resume banner', async () => {
      await presenter.mount(true);
      expect(view.setResumeBannerVisible).toHaveBeenCalledWith(true);
    });

    it('does NOT start the recorder', async () => {
      await presenter.mount(true);
      expect(WebRecorderService.start).not.toHaveBeenCalled();
    });

    it('does NOT set recording state to true', async () => {
      await presenter.mount(true);
      expect(view.setRecording).not.toHaveBeenCalledWith(true);
      expect(presenter._isRecording).toBe(false);
    });
  });

  // ── mount(true) — no active session ──────────────────────────────────────

  describe('mount(true) — no active session', () => {
    beforeEach(() => {
      SessionService.getActiveSessionId.mockResolvedValue(null);
    });

    it('still shows the resume banner', async () => {
      await presenter.mount(true);
      expect(view.setResumeBannerVisible).toHaveBeenCalledWith(true);
    });

    it('does NOT query recording state when sessionId is null', async () => {
      await presenter.mount(true);
      expect(SessionService.getRecordingActive).not.toHaveBeenCalled();
    });
  });

  // ── mount(false) — fresh start ────────────────────────────────────────────

  describe('mount(false) — fresh start', () => {
    it('does NOT show the resume banner', async () => {
      await presenter.mount(false);
      expect(view.setResumeBannerVisible).not.toHaveBeenCalled();
    });

    it('does NOT start the recorder', async () => {
      await presenter.mount(false);
      expect(WebRecorderService.start).not.toHaveBeenCalled();
    });
  });

  describe('mount() default — same as mount(false)', () => {
    it('does NOT show the resume banner', async () => {
      await presenter.mount();
      expect(view.setResumeBannerVisible).not.toHaveBeenCalled();
    });
  });

  // ── onMicPress — persists recording state ─────────────────────────────────

  describe('onMicPress — recording state persistence', () => {
    it('persists state ON when starting recording', async () => {
      await presenter.onMicPress();
      expect(SessionService.setRecordingActive).toHaveBeenCalledWith(
        'session_test_123',
        true
      );
    });

    it('persists state OFF when stopping recording', async () => {
      presenter._isRecording = true;
      await presenter.onMicPress();
      expect(SessionService.setRecordingActive).toHaveBeenCalledWith(
        'session_test_123',
        false
      );
    });

    it('does not persist when there is no active session', async () => {
      SessionService.getActiveSessionId.mockResolvedValue(null);
      await presenter.onMicPress();
      expect(SessionService.setRecordingActive).not.toHaveBeenCalled();
    });
  });

  // ── onDismissResumeBanner ─────────────────────────────────────────────────

  describe('onDismissResumeBanner', () => {
    it('hides the banner', () => {
      presenter.onDismissResumeBanner();
      expect(view.setResumeBannerVisible).toHaveBeenCalledWith(false);
    });
  });

  // ── _proceedWithCleanup clears recording state ────────────────────────────

  describe('_proceedWithCleanup — clears recording state', () => {
    beforeEach(() => {
      EndShiftService.run.mockResolvedValue({ success: true, failedItems: [], durationMs: 50 });
    });

    it('calls setRecordingActive(false) before running cleanup', async () => {
      await presenter.onOfflineGateForceDelete(navigation);
      expect(SessionService.setRecordingActive).toHaveBeenCalledWith(
        'session_test_123',
        false
      );
    });

    it('runs EndShiftService.run after clearing recording state', async () => {
      await presenter.onOfflineGateForceDelete(navigation);
      const setRecordingOrder = SessionService.setRecordingActive.mock.invocationCallOrder[0];
      const runOrder = EndShiftService.run.mock.invocationCallOrder[0];
      expect(setRecordingOrder).toBeLessThan(runOrder);
    });
  });

  // ── _resumeSession — WebRecorderService.start() fails ────────────────────

  describe('mount(true) — recorder start fails', () => {
    beforeEach(() => {
      SessionService.getRecordingActive.mockResolvedValue(true);
      WebRecorderService.start.mockRejectedValue(new Error('Device unavailable'));
    });

    it('does NOT set _isRecording to true', async () => {
      await presenter.mount(true);
      expect(presenter._isRecording).toBe(false);
    });

    it('clears the persisted recording flag so the next launch does not retry', async () => {
      await presenter.mount(true);
      expect(SessionService.setRecordingActive).toHaveBeenCalledWith(
        'session_test_123',
        false
      );
    });

    it('still shows the resume banner', async () => {
      await presenter.mount(true);
      expect(view.setResumeBannerVisible).toHaveBeenCalledWith(true);
    });
  });

  // ── _proceedWithCleanup — stops recorder if active ───────────────────────

  describe('_proceedWithCleanup — stops recorder when active', () => {
    beforeEach(() => {
      EndShiftService.run.mockResolvedValue({ success: true, failedItems: [], durationMs: 50 });
    });

    it('stops the web recorder if recording was active', async () => {
      presenter._isRecording = true;
      await presenter.onOfflineGateForceDelete(navigation);
      expect(WebRecorderService.stop).toHaveBeenCalled();
    });

    it('resets _isRecording to false and calls setRecording(false)', async () => {
      presenter._isRecording = true;
      await presenter.onOfflineGateForceDelete(navigation);
      expect(presenter._isRecording).toBe(false);
      expect(view.setRecording).toHaveBeenCalledWith(false);
    });

    it('does NOT call stop when not recording', async () => {
      presenter._isRecording = false;
      await presenter.onOfflineGateForceDelete(navigation);
      expect(WebRecorderService.stop).not.toHaveBeenCalled();
    });
  });

  // ── WebRecorderService not supported ─────────────────────────────────────

  describe('mount(true) — WebRecorderService not supported', () => {
    beforeEach(() => {
      WebRecorderService.isSupported.mockReturnValue(false);
      SessionService.getRecordingActive.mockResolvedValue(true);
    });

    it('shows the resume banner', async () => {
      await presenter.mount(true);
      expect(view.setResumeBannerVisible).toHaveBeenCalledWith(true);
    });

    it('does NOT call WebRecorderService.start', async () => {
      await presenter.mount(true);
      expect(WebRecorderService.start).not.toHaveBeenCalled();
    });

    it('still marks recording as active in presenter state', async () => {
      await presenter.mount(true);
      expect(presenter._isRecording).toBe(true);
      expect(view.setRecording).toHaveBeenCalledWith(true);
    });
  });
});
