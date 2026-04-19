/**
 * DashboardPresenter — US21: Active patient selection
 *
 * Tests:
 *   - onBedPress → sets active patient
 *   - onClearActivePatient → resets to null (X button)
 *   - getApiHints → returns hint fields when active, {} when not
 *   - onMicPress (no active patient) → auto-creates bed, sets active, refreshes list
 *   - onMicPress (active patient set) → no auto-create, records normally
 *   - onSuccessDismiss → clears active patient on shift end
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
    setRecordingActive: jest.fn(),
    clearCache: jest.fn(),
  },
}));

jest.mock('../../services/audio/AudioSourceResolver', () => ({
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
    check: jest.fn(),
    ensure: jest.fn(),
    request: jest.fn(),
    openSettings: jest.fn(),
  },
}));

jest.mock('../../repositories', () => ({
  getStorage: jest.fn().mockResolvedValue({
    queryBySession: jest.fn(),
    create: jest.fn(),
    bulkDelete: jest.fn(),
  }),
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import DashboardPresenter from '../../presenters/DashboardPresenter';
import SessionService from '../../services/SessionService';
import EndShiftService from '../../services/EndShiftService';
import PermissionsService from '../../services/PermissionsService';
import { getStorage } from '../../repositories';

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
  };
}

function makeNavigation() {
  return { reset: jest.fn(), navigate: jest.fn(), goBack: jest.fn() };
}

const ALICE = { id: 'p1', name: 'Alice', bed: '1', status: 'active' };
const BOB   = { id: 'p2', name: 'Bob',   bed: '2', status: 'active' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardPresenter — US21 active patient', () => {
  let presenter;
  let view;
  let navigation;
  let storage;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Re-apply implementations after clearAllMocks
    SessionService.getActiveSessionId.mockResolvedValue('session_test_123');
    SessionService.setRecordingActive.mockResolvedValue(undefined);
    PermissionsService.ensure.mockResolvedValue('granted');
    PermissionsService.check.mockResolvedValue('granted');

    storage = await getStorage();
    storage.queryBySession.mockResolvedValue([]);
    storage.create.mockResolvedValue(null);
    storage.bulkDelete.mockResolvedValue(0);

    view = makeView();
    navigation = makeNavigation();
    presenter = new DashboardPresenter(view);
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it('starts with no active patient', () => {
    expect(presenter._activePatient).toBeNull();
  });

  // ── onBedPress ─────────────────────────────────────────────────────────────

  describe('onBedPress', () => {
    it('sets the tapped patient as active', () => {
      presenter.onBedPress(ALICE);
      expect(presenter._activePatient).toEqual({ id: 'p1', name: 'Alice', bed: '1' });
      expect(view.setActivePatient).toHaveBeenCalledWith({ id: 'p1', name: 'Alice', bed: '1' });
    });

    it('switching tap replaces the active patient', () => {
      presenter.onBedPress(ALICE);
      presenter.onBedPress(BOB);
      expect(presenter._activePatient).toEqual({ id: 'p2', name: 'Bob', bed: '2' });
      expect(view.setActivePatient).toHaveBeenLastCalledWith({ id: 'p2', name: 'Bob', bed: '2' });
    });

    it('tapping the same patient again keeps it active', () => {
      presenter.onBedPress(ALICE);
      presenter.onBedPress(ALICE);
      expect(presenter._activePatient).toEqual({ id: 'p1', name: 'Alice', bed: '1' });
    });

    it('only stores id, name, bed — not extra fields', () => {
      presenter.onBedPress({ ...ALICE, status: 'active', recording_count: 5 });
      expect(presenter._activePatient).toEqual({ id: 'p1', name: 'Alice', bed: '1' });
    });
  });

  // ── onClearActivePatient ───────────────────────────────────────────────────

  describe('onClearActivePatient', () => {
    it('resets active patient to null', () => {
      presenter.onBedPress(ALICE);
      presenter.onClearActivePatient();
      expect(presenter._activePatient).toBeNull();
      expect(view.setActivePatient).toHaveBeenLastCalledWith(null);
    });

    it('is a no-op when already null', () => {
      presenter.onClearActivePatient();
      expect(presenter._activePatient).toBeNull();
      expect(view.setActivePatient).toHaveBeenCalledWith(null);
    });
  });

  // ── getApiHints ────────────────────────────────────────────────────────────

  describe('getApiHints', () => {
    it('returns {} when no active patient', () => {
      expect(presenter.getApiHints()).toEqual({});
    });

    it('returns hint_patient_name and hint_room when active', () => {
      presenter.onBedPress(ALICE);
      expect(presenter.getApiHints()).toEqual({
        hint_patient_name: 'Alice',
        hint_room: '1',
      });
    });

    it('updates after switching patients', () => {
      presenter.onBedPress(ALICE);
      presenter.onBedPress(BOB);
      expect(presenter.getApiHints()).toEqual({
        hint_patient_name: 'Bob',
        hint_room: '2',
      });
    });

    it('returns {} after clearing active patient', () => {
      presenter.onBedPress(ALICE);
      presenter.onClearActivePatient();
      expect(presenter.getApiHints()).toEqual({});
    });
  });

  // ── onMicPress — active patient already set ────────────────────────────────

  describe('onMicPress — active patient set', () => {
    it('does NOT auto-create a patient', async () => {
      presenter.onBedPress(ALICE);
      await presenter.onMicPress();
      expect(storage.create).not.toHaveBeenCalled();
    });

    it('starts recording', async () => {
      presenter.onBedPress(ALICE);
      await presenter.onMicPress();
      expect(view.setRecording).toHaveBeenCalledWith(true);
    });

    it('active patient remains unchanged after mic press', async () => {
      presenter.onBedPress(ALICE);
      await presenter.onMicPress();
      expect(presenter._activePatient).toEqual({ id: 'p1', name: 'Alice', bed: '1' });
    });
  });

  // ── onMicPress — no active patient → auto-create ───────────────────────────

  describe('onMicPress — no active patient', () => {
    const NEW_PATIENT = { id: 'p3', name: '', bed: '3' };

    beforeEach(() => {
      storage.queryBySession.mockResolvedValue([ALICE, BOB]);
      storage.create.mockResolvedValue(NEW_PATIENT);
    });

    it('creates a new patient with the next bed number', async () => {
      await presenter.onMicPress();
      expect(storage.create).toHaveBeenCalledWith(
        'patients',
        expect.objectContaining({
          session_id: 'session_test_123',
          bed: '3',
          name: '',
          status: 'active',
        })
      );
    });

    it('sets the new patient as active', async () => {
      await presenter.onMicPress();
      expect(presenter._activePatient).toEqual({ id: 'p3', name: '', bed: '3' });
      expect(view.setActivePatient).toHaveBeenCalledWith({ id: 'p3', name: '', bed: '3' });
    });

    it('refreshes the bed list after creating', async () => {
      await presenter.onMicPress();
      expect(view.setBeds).toHaveBeenCalled();
    });

    it('starts recording after auto-create', async () => {
      await presenter.onMicPress();
      expect(view.setRecording).toHaveBeenCalledWith(true);
    });

    it('does not set active patient if DB create returns null', async () => {
      storage.create.mockResolvedValue(null);
      await presenter.onMicPress();
      expect(presenter._activePatient).toBeNull();
      expect(view.setRecording).toHaveBeenCalledWith(true);
    });

    it('skips auto-create if there is no active session', async () => {
      SessionService.getActiveSessionId.mockResolvedValue(null);
      await presenter.onMicPress();
      expect(storage.create).not.toHaveBeenCalled();
    });
  });

  // ── onSuccessDismiss — clears active patient on shift end ──────────────────

  describe('onSuccessDismiss', () => {
    beforeEach(() => {
      EndShiftService.run.mockResolvedValue({ success: true, failedItems: [], durationMs: 50 });
    });

    it('clears active patient when shift ends', () => {
      presenter.onBedPress(ALICE);
      presenter.onSuccessDismiss(navigation);
      expect(presenter._activePatient).toBeNull();
      expect(view.setActivePatient).toHaveBeenLastCalledWith(null);
    });

    it('does not call setActivePatient if no patient was active', () => {
      presenter.onSuccessDismiss(navigation);
      expect(view.setActivePatient).not.toHaveBeenCalled();
    });
  });
});
