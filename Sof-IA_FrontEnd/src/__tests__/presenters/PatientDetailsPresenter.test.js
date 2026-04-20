/**
 * PatientDetailsPresenter — US10
 *
 * Tests:
 *   buildCards — segments with medications → card present
 *   buildCards — empty segments → empty array
 *   buildCards — recent activity built from latest segment
 *   buildCards — vitals from most recent segment that has vitals
 *   buildCards — deduplicates medications across segments
 *   buildCards — allergies + notes come from patient record
 *   buildCards — flagged defaults to false, confidence defaults to 1.0
 *   _loadSessionCard — uses expires_at from session when present
 *   _loadSessionCard — falls back to started_at + 14h when expires_at is null
 *   onCardPress — calls console.log (stub, not navigation)
 *   unmount — clears poll interval and unsubscribes recording
 */

// ─── React Native mock ────────────────────────────────────────────────────────

jest.mock('react-native', () => ({
    Platform: { OS: 'web', select: jest.fn((obj) => obj.web ?? obj.default) },
    StyleSheet: { create: (s) => s },
    AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

// ─── Service mocks ────────────────────────────────────────────────────────────

jest.mock('../../services/audio/AudioSourceResolver', () => ({
    __esModule: true,
    default: {
        resolve: jest.fn().mockResolvedValue({
            getSourceKey: () => 'builtin',
            getSourceLabel: () => 'Built-in mic',
        }),
        getAvailableSources: jest.fn().mockResolvedValue([]),
        resetOverride: jest.fn(),
    },
}));

// ContinuousRecordingService is globally mocked in jest.setup.js

jest.mock('../../services/audio/WebRecorderService', () => ({
    __esModule: true,
    default: {
        isSupported: jest.fn().mockReturnValue(true),
    },
}));

jest.mock('../../services/SessionService', () => ({
    __esModule: true,
    default: {
        getActiveShift: jest.fn(),
        getActiveSessionId: jest.fn(),
    },
}));

jest.mock('../../repositories', () => ({
    getStorage: jest.fn().mockResolvedValue({
        queryBySession: jest.fn().mockResolvedValue([]),
    }),
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import PatientDetailsPresenter, { buildCards } from '../../presenters/PatientDetailsPresenter';
import SessionService from '../../services/SessionService';
import { getStorage } from '../../repositories';

// The global jest.setup.js mock is a plain object (no default wrapper), so we require it directly
const ContinuousRecordingService = require('../../services/audio/ContinuousRecordingService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeView() {
    return {
        setAudioSource:      jest.fn(),
        setRecording:        jest.fn(),
        setConnectionStatus: jest.fn(),
        setBrowserSupported: jest.fn(),
        setSessionCard:      jest.fn(),
        setCards:            jest.fn(),
    };
}

function makeSegment(overrides = {}) {
    return {
        id: 'seg-1',
        session_id: 'session-abc',
        bed_id: null,
        ts_start: Date.now(),
        transcript: 'Patient is stable',
        language: 'fr',
        confidence: 0.95,
        structured_json: null,
        ...overrides,
    };
}

function makePatient(overrides = {}) {
    return { id: 'p-1', bed: '1', name: 'Alice', allergies: null, notes: null, ...overrides };
}

// ─── buildCards (pure function) ───────────────────────────────────────────────

describe('buildCards', () => {
    it('returns empty array when no segments and no patient data', () => {
        const cards = buildCards([], makePatient());
        expect(cards).toEqual([]);
    });

    it('builds recent_activity card from segment with transcript', () => {
        const seg = makeSegment({ transcript: 'Checked vitals', structured_json: null });
        const cards = buildCards([seg], makePatient());
        expect(cards.find((c) => c.type === 'recent_activity')).toBeTruthy();
    });

    it('builds recent_activity preview with activity_type and language', () => {
        const seg = makeSegment({
            ts_start: new Date('2026-04-20T08:30:00Z').getTime(),
            language: 'fr',
            structured_json: JSON.stringify({ activity_type: 'Pain assessment', medications: null, vitals: null, actions: null }),
        });
        const cards = buildCards([seg], makePatient());
        const card = cards.find((c) => c.type === 'recent_activity');
        expect(card.preview).toContain('Pain assessment');
        expect(card.preview).toContain('fr');
    });

    it('builds medications card and deduplicates across segments', () => {
        const seg1 = makeSegment({ id: 's1', structured_json: JSON.stringify({ medications: ['Paracetamol', 'Ibuprofen'] }) });
        const seg2 = makeSegment({ id: 's2', structured_json: JSON.stringify({ medications: ['Ibuprofen', 'Morphine'] }) });
        const cards = buildCards([seg1, seg2], makePatient());
        const med = cards.find((c) => c.type === 'medications');
        expect(med).toBeTruthy();
        expect(med.items).toEqual(['Paracetamol', 'Ibuprofen', 'Morphine']);
    });

    it('builds vital_signs card from latest segment with vitals', () => {
        const older = makeSegment({ id: 's1', ts_start: 1000, structured_json: JSON.stringify({ vitals: { hr: 70 } }) });
        const newer = makeSegment({ id: 's2', ts_start: 2000, structured_json: JSON.stringify({ vitals: { hr: 80, bp: '120/80' } }) });
        const cards = buildCards([older, newer], makePatient());
        const card = cards.find((c) => c.type === 'vital_signs');
        expect(card).toBeTruthy();
        expect(card.data).toEqual({ hr: 80, bp: '120/80' });
    });

    it('builds next_reminder card from actions', () => {
        const seg = makeSegment({ structured_json: JSON.stringify({ actions: ['Administer medication', 'Update chart'] }) });
        const cards = buildCards([seg], makePatient());
        const card = cards.find((c) => c.type === 'next_reminder');
        expect(card).toBeTruthy();
        expect(card.preview).toBe('Administer medication');
    });

    it('builds allergies card from patient.allergies', () => {
        const cards = buildCards([], makePatient({ allergies: 'Penicillin, Latex' }));
        const card = cards.find((c) => c.type === 'allergies');
        expect(card).toBeTruthy();
        expect(card.preview).toBe('Penicillin, Latex');
    });

    it('builds safety_info card from patient.notes', () => {
        const cards = buildCards([], makePatient({ notes: 'Fall risk' }));
        const card = cards.find((c) => c.type === 'safety_info');
        expect(card).toBeTruthy();
        expect(card.preview).toBe('Fall risk');
    });

    it('all cards default flagged=false and confidence=1.0', () => {
        const seg = makeSegment({ structured_json: JSON.stringify({ medications: ['Aspirin'] }) });
        const cards = buildCards([seg], makePatient({ allergies: 'Pollen' }));
        for (const card of cards) {
            expect(card.flagged).toBe(false);
            expect(card.confidence).toBe(1.0);
        }
    });

    it('skips segments with malformed structured_json without throwing', () => {
        const seg = makeSegment({ structured_json: '{bad json}' });
        expect(() => buildCards([seg], makePatient())).not.toThrow();
    });

    it('filters out segments whose bed_id does not match patient.id', () => {
        const seg = makeSegment({ bed_id: 'other-patient', structured_json: JSON.stringify({ medications: ['X'] }) });
        const cards = buildCards([seg], makePatient({ id: 'p-1' }));
        expect(cards.find((c) => c.type === 'medications')).toBeUndefined();
    });

    it('includes segments with null bed_id regardless of patient', () => {
        const seg = makeSegment({ bed_id: null, structured_json: JSON.stringify({ medications: ['X'] }) });
        const cards = buildCards([seg], makePatient({ id: 'p-1' }));
        expect(cards.find((c) => c.type === 'medications')).toBeTruthy();
    });
});

// ─── _loadSessionCard ─────────────────────────────────────────────────────────

describe('_loadSessionCard', () => {
    it('uses expires_at from session when present', async () => {
        SessionService.getActiveShift.mockResolvedValue({
            started_at: '2026-04-20T07:00:00.000Z',
            expires_at: '2026-04-20T21:00:00.000Z',
        });
        const view = makeView();
        const p = new PatientDetailsPresenter(view);
        await p._loadSessionCard();
        expect(view.setSessionCard).toHaveBeenCalledWith({
            startedAt: '2026-04-20T07:00:00.000Z',
            expiresAt: '2026-04-20T21:00:00.000Z',
        });
    });

    it('falls back to started_at + 14h when expires_at is null', async () => {
        SessionService.getActiveShift.mockResolvedValue({
            started_at: '2026-04-20T07:00:00.000Z',
            expires_at: null,
        });
        const view = makeView();
        const p = new PatientDetailsPresenter(view);
        await p._loadSessionCard();
        const call = view.setSessionCard.mock.calls[0][0];
        const expected = new Date('2026-04-20T07:00:00.000Z').getTime() + 14 * 60 * 60 * 1000;
        expect(new Date(call.expiresAt).getTime()).toBe(expected);
    });

    it('calls setSessionCard(null) when no active session', async () => {
        SessionService.getActiveShift.mockResolvedValue(null);
        const view = makeView();
        const p = new PatientDetailsPresenter(view);
        await p._loadSessionCard();
        expect(view.setSessionCard).toHaveBeenCalledWith(null);
    });
});

// ─── onCardPress ──────────────────────────────────────────────────────────────

describe('onCardPress', () => {
    it('logs the card type (stub — does not navigate)', () => {
        const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const p = new PatientDetailsPresenter(makeView());
        p.onCardPress({ type: 'medications' }, { navigate: jest.fn() });
        expect(spy).toHaveBeenCalledWith(
            '[PatientDetailsPresenter] card tapped:',
            'medications'
        );
        spy.mockRestore();
    });
});

// ─── unmount ──────────────────────────────────────────────────────────────────

describe('unmount', () => {
    it('calls the unsubscribe function returned by subscribe on unmount', async () => {
        const unsub = jest.fn();
        // The global setup mock returns jest.fn() — override just for this test
        ContinuousRecordingService.subscribe.mockImplementationOnce(() => unsub);
        SessionService.getActiveShift.mockResolvedValue(null);
        SessionService.getActiveSessionId.mockResolvedValue('session-abc');

        const storage = await getStorage();
        storage.queryBySession.mockResolvedValue([]);

        const view = makeView();
        const p = new PatientDetailsPresenter(view);
        await p.mount({ patient: makePatient(), sessionId: 'session-abc' });
        p.unmount();

        expect(unsub).toHaveBeenCalled();
    });
});