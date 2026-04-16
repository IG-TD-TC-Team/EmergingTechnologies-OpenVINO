/**
 * EndShiftService Tests
 *
 * Uses a real DexieAdapter backed by fake-indexeddb so every assertion
 * exercises actual DB reads/writes — no hand-wavy mocks for storage.
 */

import { v4 as uuidv4 } from 'uuid';
import { DexieAdapter } from '../../repositories/adapters/dexie/DexieAdapter';
import EndShiftService from '../../services/EndShiftService';

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

jest.mock('react-native', () => ({
  Platform: { OS: 'android', select: jest.fn((obj: any) => obj.android ?? obj.default) },
}));
jest.mock('../../repositories', () => ({ getStorage: jest.fn() }));
jest.mock('../../services/SessionService', () => ({
  __esModule: true,
  default: { clearCache: jest.fn() },
}));

// ─── Imports that depend on the mocks above ────────────────────────────────────

import { getStorage } from '../../repositories';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_ID = 'session_test_20260414_120000';
const OTHER_SESSION = 'session_other_20260414_130000';

const now = () => new Date().toISOString();
const expires = () => new Date(Date.now() + 86400000).toISOString();

function makePatient(sessionId = SESSION_ID) {
  return {
    id: uuidv4(),
    session_id: sessionId,
    nombre: 'Test',
    apellido: 'Nurse',
    edad: 30,
    genero: 'F',
    created_at: now(),
    expires_at: expires(),
  };
}

function makeRecording(sessionId = SESSION_ID, status = 'stopped') {
  return {
    id: uuidv4(),
    session_id: sessionId,
    status,
    file_path: 'blob:fake',
    filename: 'rec.m4a',
    patient_id: null,
    created_at: now(),
    expires_at: expires(),
  };
}

function makeTranscription(sessionId = SESSION_ID, status = 'pending') {
  return {
    id: uuidv4(),
    session_id: sessionId,
    status,
    audio_recording_id: uuidv4(),
    text: '',
    created_at: now(),
    expires_at: expires(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EndShiftService', () => {
  let adapter: DexieAdapter;

  beforeEach(() => {
    const dbName = `endshift_${Date.now()}_${Math.random()}`;
    adapter = new DexieAdapter(dbName);
    (getStorage as jest.Mock).mockResolvedValue(adapter);
  });

  // ── flushQueue ──────────────────────────────────────────────────────────────

  describe('flushQueue', () => {
    it('returns success when there are no recordings', async () => {
      const result = await EndShiftService.flushQueue(SESSION_ID);
      expect(result).toEqual({ success: true, pendingCount: 0 });
    });

    it('returns success when all recordings are already uploaded', async () => {
      await adapter.create('audio_recordings', makeRecording(SESSION_ID, 'uploaded'));
      await adapter.create('audio_recordings', makeRecording(SESSION_ID, 'transcribed'));

      const result = await EndShiftService.flushQueue(SESSION_ID);
      expect(result).toEqual({ success: true, pendingCount: 0 });
    });

    it('returns success:false when STOPPED recordings exist', async () => {
      await adapter.create('audio_recordings', makeRecording(SESSION_ID, 'stopped'));

      const result = await EndShiftService.flushQueue(SESSION_ID);
      expect(result.success).toBe(false);
      expect(result.pendingCount).toBe(1);
    });

    it('counts FAILED recordings as pending', async () => {
      await adapter.create('audio_recordings', makeRecording(SESSION_ID, 'failed'));

      const result = await EndShiftService.flushQueue(SESSION_ID);
      expect(result.success).toBe(false);
      expect(result.pendingCount).toBe(1);
    });

    it('counts PENDING transcriptions as pending', async () => {
      await adapter.create('transcriptions', makeTranscription(SESSION_ID, 'pending'));

      const result = await EndShiftService.flushQueue(SESSION_ID);
      expect(result.success).toBe(false);
      expect(result.pendingCount).toBe(1);
    });

    it('sums recordings and transcriptions into pendingCount', async () => {
      await adapter.create('audio_recordings', makeRecording(SESSION_ID, 'stopped'));
      await adapter.create('audio_recordings', makeRecording(SESSION_ID, 'stopped'));
      await adapter.create('transcriptions', makeTranscription(SESSION_ID, 'failed'));

      const result = await EndShiftService.flushQueue(SESSION_ID);
      expect(result.success).toBe(false);
      expect(result.pendingCount).toBe(3);
    });

    it('ignores records from other sessions', async () => {
      await adapter.create('audio_recordings', makeRecording(OTHER_SESSION, 'stopped'));

      const result = await EndShiftService.flushQueue(SESSION_ID);
      expect(result).toEqual({ success: true, pendingCount: 0 });
    });
  });

  // ── run ─────────────────────────────────────────────────────────────────────

  describe('run', () => {
    it('returns success with empty failedItems on empty session', async () => {
      const result = await EndShiftService.run(SESSION_ID);

      expect(result.success).toBe(true);
      expect(result.failedItems).toHaveLength(0);
    });

    it('deletes all patients for the session', async () => {
      await adapter.create('patients', makePatient(SESSION_ID));
      await adapter.create('patients', makePatient(SESSION_ID));

      const result = await EndShiftService.run(SESSION_ID);

      expect(result.success).toBe(true);
      const remaining = await adapter.queryBySession('patients', SESSION_ID);
      expect(remaining).toHaveLength(0);
    });

    it('deletes audio_recordings for the session', async () => {
      await adapter.create('audio_recordings', makeRecording(SESSION_ID, 'stopped'));
      await adapter.create('audio_recordings', makeRecording(SESSION_ID, 'uploaded'));

      await EndShiftService.run(SESSION_ID);

      const remaining = await adapter.queryBySession('audio_recordings', SESSION_ID);
      expect(remaining).toHaveLength(0);
    });

    it('deletes transcriptions for the session', async () => {
      await adapter.create('transcriptions', makeTranscription(SESSION_ID, 'completed'));

      await EndShiftService.run(SESSION_ID);

      const remaining = await adapter.queryBySession('transcriptions', SESSION_ID);
      expect(remaining).toHaveLength(0);
    });

    it('does NOT delete records belonging to a different session', async () => {
      await adapter.create('patients', makePatient(SESSION_ID));
      await adapter.create('patients', makePatient(OTHER_SESSION));

      await EndShiftService.run(SESSION_ID);

      const sessionRemaining = await adapter.queryBySession('patients', SESSION_ID);
      const otherRemaining = await adapter.queryBySession('patients', OTHER_SESSION);

      expect(sessionRemaining).toHaveLength(0);
      expect(otherRemaining).toHaveLength(1);
    });

    it('completes within 5 seconds', async () => {
      await adapter.create('patients', makePatient());
      await adapter.create('patients', makePatient());
      await adapter.create('audio_recordings', makeRecording());

      const result = await EndShiftService.run(SESSION_ID);
      expect(result.durationMs).toBeLessThan(5000);
    });

    it('returns durationMs as a positive number', async () => {
      const result = await EndShiftService.run(SESSION_ID);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('lists failed stores without throwing when bulkDelete rejects', async () => {
      jest.spyOn(adapter, 'bulkDelete').mockRejectedValueOnce(new Error('DB locked'));

      const result = await EndShiftService.run(SESSION_ID);

      expect(result.success).toBe(false);
      expect(result.failedItems.length).toBeGreaterThan(0);
      expect(result.failedItems[0]).toMatch(/DB delete failed/);
    });

    it('reports verification failure when records survive deletion', async () => {
      await adapter.create('patients', makePatient(SESSION_ID));
      // Make bulkDelete a no-op so records stay
      jest.spyOn(adapter, 'bulkDelete').mockResolvedValue(0);

      const result = await EndShiftService.run(SESSION_ID);

      expect(result.success).toBe(false);
      expect(result.failedItems.some((f) => f.includes('patients'))).toBe(true);
    });

    it('calls SessionService.clearCache during cleanup', async () => {
      const SessionService = require('../../services/SessionService').default;

      await EndShiftService.run(SESSION_ID);

      expect(SessionService.clearCache).toHaveBeenCalled();
    });
  });
});
