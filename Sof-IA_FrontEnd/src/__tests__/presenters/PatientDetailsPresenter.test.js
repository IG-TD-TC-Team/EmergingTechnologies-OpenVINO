/**
 * PatientDetailsPresenter — US10
 *
 * Tests:
 *   buildCards — empty inputs → empty array
 *   buildCards — recent activity built from latest segment
 *   buildCards — vitals from most recent segment that has vitals
 *   buildCards — medications from structured card rows (not segments)
 *   buildCards — medications: deduplicates by name, keeps newest entry
 *   buildCards — medications: sorted ascending by next_due
 *   buildCards — medications: preview format "Name — due HH:MM"
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
        queryBySession:        jest.fn().mockResolvedValue([]),
        queryBySessionAndBed:  jest.fn().mockResolvedValue([]),
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

// ─── Card-row factories ────────────────────────────────────────────────────────

function makeVitalRow(overrides = {}) {
    return {
        blood_pressure: '120/80',
        heart_rate:     72,
        temperature:    37.2,
        spo2:           98,
        timestamp:      '2026-04-19T09:15:00.000Z',
        session_id:     'session-abc',
        bed_id:         'p-1',
        flagged:        false,
        confidence:     0.91,
        ...overrides,
    };
}

function makeSafetyRow(overrides = {}) {
    return {
        safety_flag: 'fall_risk',
        description: 'Patient has history of falls; bed rails must remain raised.',
        session_id:  'session-abc',
        bed_id:      'p-1',
        flagged:     false,
        confidence:  0.89,
        ...overrides,
    };
}

function makeAllergyRow(overrides = {}) {
    return {
        allergen:      'Penicillin',
        reaction_type: 'anaphylaxis',
        severity:      'severe',
        session_id:    'session-abc',
        bed_id:        'p-1',
        flagged:       false,
        confidence:    0.97,
        ...overrides,
    };
}

function makeMedRow(overrides = {}) {
    return {
        medication_name: 'Paracetamol',
        dose:            '1g',
        frequency:       'every 6h',
        next_due:        '2026-04-19T14:30:00.000Z',
        administered_at: null,
        session_id:      'session-abc',
        bed_id:          'p-1',
        flagged:         false,
        confidence:      0.94,
        ...overrides,
    };
}

// ─── buildCards (pure function) ───────────────────────────────────────────────

describe('buildCards', () => {
    it('returns empty array when no segments, no medications, no vitals, and no patient data', () => {
        const cards = buildCards([], [], [], [], [], makePatient());
        expect(cards).toEqual([]);
    });

    it('builds recent_activity card from segment with transcript', () => {
        const seg = makeSegment({ transcript: 'Checked vitals', structured_json: null });
        const cards = buildCards([seg], [], [], [], [], makePatient());
        expect(cards.find((c) => c.type === 'recent_activity')).toBeTruthy();
    });

    it('builds recent_activity preview with activity_type when present', () => {
        const seg = makeSegment({
            ts_start: new Date('2026-04-20T08:30:00Z').getTime(),
            language: 'fr',
            structured_json: JSON.stringify({ activity_type: 'Pain assessment', medications: null, vitals: null, actions: null }),
        });
        const cards = buildCards([seg], [], [], [], [], makePatient());
        const card = cards.find((c) => c.type === 'recent_activity');
        expect(card.preview).toContain('Pain assessment');
    });

    it('builds recent_activity preview with language when no activity_type', () => {
        const seg = makeSegment({
            ts_start: new Date('2026-04-20T08:30:00Z').getTime(),
            language: 'fr',
            structured_json: JSON.stringify({ activity_type: null, medications: null, vitals: null, actions: null }),
        });
        const cards = buildCards([seg], [], [], [], [], makePatient());
        const card = cards.find((c) => c.type === 'recent_activity');
        expect(card.preview).toContain('Language: fr');
    });

    // ── Medications ─────────────────────────────────────────────────────────────

    it('builds medications card from structured medication rows', () => {
        const med = makeMedRow();
        const cards = buildCards([], [med], [], [], [], makePatient());
        const medCard = cards.find((c) => c.type === 'medications');
        expect(medCard).toBeTruthy();
        expect(medCard.hasData).toBe(true);
    });

    it('medications: deduplicates by medication_name, keeping newest (first) entry', () => {
        const newest = makeMedRow({ medication_name: 'Paracetamol', next_due: '2026-04-19T20:30:00.000Z' });
        const older  = makeMedRow({ medication_name: 'Paracetamol', next_due: '2026-04-19T14:30:00.000Z' });
        const cards = buildCards([], [newest, older], [], [], [], makePatient());
        const medCard = cards.find((c) => c.type === 'medications');
        expect(medCard.items.length).toBe(1);
        expect(medCard.items[0].next_due).toBe('2026-04-19T20:30:00.000Z');
    });

    it('medications: sorted ascending by next_due after deduplication', () => {
        const later   = makeMedRow({ medication_name: 'Metformin',   next_due: '2026-04-19T20:00:00.000Z' });
        const earlier = makeMedRow({ medication_name: 'Paracetamol', next_due: '2026-04-19T14:30:00.000Z' });
        const cards = buildCards([], [later, earlier], [], [], [], makePatient());
        const medCard = cards.find((c) => c.type === 'medications');
        expect(medCard.items[0].medication_name).toBe('Paracetamol');
        expect(medCard.items[1].medication_name).toBe('Metformin');
    });

    it('medications: preview contains "Name — due HH:MM" for the first item', () => {
        const med = makeMedRow({ medication_name: 'Paracetamol', next_due: '2026-04-19T14:30:00.000Z' });
        const cards = buildCards([], [med], [], [], [], makePatient());
        const medCard = cards.find((c) => c.type === 'medications');
        expect(medCard.preview).toMatch(/Paracetamol — due \d{1,2}:\d{2}/);
    });

    it('medications: preview joins first two items with ", " when multiple', () => {
        const med1 = makeMedRow({ medication_name: 'Paracetamol', next_due: '2026-04-19T14:30:00.000Z' });
        const med2 = makeMedRow({ medication_name: 'Metformin',   next_due: '2026-04-19T20:00:00.000Z' });
        const med3 = makeMedRow({ medication_name: 'Ibuprofen',   next_due: '2026-04-19T22:00:00.000Z' });
        const cards = buildCards([], [med1, med2, med3], [], [], [], makePatient());
        const medCard = cards.find((c) => c.type === 'medications');
        expect(medCard.preview).toContain('Paracetamol');
        expect(medCard.preview).toContain('Metformin');
        expect(medCard.preview).not.toContain('Ibuprofen');
    });

    it('medications: no card when medications array is empty', () => {
        const cards = buildCards([], [], [], [], [], makePatient());
        expect(cards.find((c) => c.type === 'medications')).toBeUndefined();
    });

    it('medications: items are structured objects with all card fields', () => {
        const med = makeMedRow();
        const cards = buildCards([], [med], [], [], [], makePatient());
        const medCard = cards.find((c) => c.type === 'medications');
        expect(medCard.items[0]).toMatchObject({
            medication_name: 'Paracetamol',
            dose:            '1g',
            frequency:       'every 6h',
            next_due:        '2026-04-19T14:30:00.000Z',
        });
    });

    // ── Vital Signs ─────────────────────────────────────────────────────────────

    it('builds vital_signs card from structured vital signs rows', () => {
        const vital = makeVitalRow();
        const cards = buildCards([], [], [vital], [], [], makePatient());
        const vsCard = cards.find((c) => c.type === 'vital_signs');
        expect(vsCard).toBeTruthy();
        expect(vsCard.hasData).toBe(true);
    });

    it('vital_signs: takes the row with the latest timestamp field', () => {
        const older  = makeVitalRow({ heart_rate: 70, timestamp: '2026-04-19T08:00:00.000Z' });
        const latest = makeVitalRow({ heart_rate: 80, timestamp: '2026-04-19T09:15:00.000Z' });
        const cards = buildCards([], [], [older, latest], [], [], makePatient());
        const vsCard = cards.find((c) => c.type === 'vital_signs');
        expect(vsCard.data.heart_rate).toBe(80);
    });

    it('vital_signs: preview format "BP 120/80 — HR 72 — HH:MM"', () => {
        const vital = makeVitalRow({
            blood_pressure: '120/80',
            heart_rate:     72,
            temperature:    null,
            spo2:           null,
            timestamp:      '2026-04-19T09:15:00.000Z',
        });
        const cards = buildCards([], [], [vital], [], [], makePatient());
        const vsCard = cards.find((c) => c.type === 'vital_signs');
        expect(vsCard.preview).toMatch(/^BP 120\/80 — HR 72 — \d{1,2}:\d{2}$/);
    });

    it('vital_signs: temperature and spo2 included when non-null', () => {
        const vital = makeVitalRow({ temperature: 37.2, spo2: 98 });
        const cards = buildCards([], [], [vital], [], [], makePatient());
        const vsCard = cards.find((c) => c.type === 'vital_signs');
        expect(vsCard.preview).toContain('T 37.2°C');
        expect(vsCard.preview).toContain('SpO2 98%');
    });

    it('vital_signs: omits null fields from preview', () => {
        const vital = makeVitalRow({
            blood_pressure: null,
            heart_rate:     72,
            temperature:    null,
            spo2:           null,
        });
        const cards = buildCards([], [], [vital], [], [], makePatient());
        const vsCard = cards.find((c) => c.type === 'vital_signs');
        expect(vsCard.preview).not.toContain('BP');
        expect(vsCard.preview).toContain('HR 72');
    });

    it('vital_signs: data property is the full latest row', () => {
        const vital = makeVitalRow();
        const cards = buildCards([], [], [vital], [], [], makePatient());
        const vsCard = cards.find((c) => c.type === 'vital_signs');
        expect(vsCard.data).toMatchObject({
            blood_pressure: '120/80',
            heart_rate:     72,
            temperature:    37.2,
            spo2:           98,
        });
    });

    it('vital_signs: no card when vitalSigns array is empty', () => {
        const cards = buildCards([], [], [], [], [], makePatient());
        expect(cards.find((c) => c.type === 'vital_signs')).toBeUndefined();
    });

    // ── Other cards ─────────────────────────────────────────────────────────────

    it('builds next_reminder card from actions', () => {
        const seg = makeSegment({ structured_json: JSON.stringify({ actions: ['Administer medication', 'Update chart'] }) });
        const cards = buildCards([seg], [], [], [], [], makePatient());
        const card = cards.find((c) => c.type === 'next_reminder');
        expect(card).toBeTruthy();
        expect(card.preview).toBe('Administer medication');
    });

    // ── Allergies ────────────────────────────────────────────────────────────────

    it('builds allergies card from allergy table rows', () => {
        const allergy = makeAllergyRow();
        const cards = buildCards([], [], [], [allergy], makePatient());
        const card = cards.find((c) => c.type === 'allergies');
        expect(card).toBeTruthy();
        expect(card.hasData).toBe(true);
    });

    it('allergies: preview aggregates allergen names', () => {
        const rows = [
            makeAllergyRow({ allergen: 'Penicillin', severity: 'severe' }),
            makeAllergyRow({ allergen: 'Latex',      severity: 'mild' }),
        ];
        const cards = buildCards([], [], [], rows, makePatient());
        const card = cards.find((c) => c.type === 'allergies');
        expect(card.preview).toBe('Penicillin, Latex');
    });

    it('allergies: deduplicates allergen names in preview', () => {
        const rows = [
            makeAllergyRow({ allergen: 'Penicillin' }),
            makeAllergyRow({ allergen: 'Penicillin' }),
        ];
        const cards = buildCards([], [], [], rows, makePatient());
        const card = cards.find((c) => c.type === 'allergies');
        expect(card.preview).toBe('Penicillin');
    });

    it('allergies: flagged=true when any row has severity "Critical"', () => {
        const rows = [
            makeAllergyRow({ allergen: 'Penicillin', severity: 'Critical' }),
            makeAllergyRow({ allergen: 'Latex',      severity: 'mild' }),
        ];
        const cards = buildCards([], [], [], rows, makePatient());
        const card = cards.find((c) => c.type === 'allergies');
        expect(card.flagged).toBe(true);
    });

    it('allergies: flagged=true when any row has severity "High"', () => {
        const rows = [makeAllergyRow({ allergen: 'Aspirin', severity: 'High' })];
        const cards = buildCards([], [], [], rows, makePatient());
        const card = cards.find((c) => c.type === 'allergies');
        expect(card.flagged).toBe(true);
    });

    it('allergies: flagged=false when no row has high severity', () => {
        const rows = [
            makeAllergyRow({ allergen: 'Latex',   severity: 'mild' }),
            makeAllergyRow({ allergen: 'Aspirin', severity: 'moderate' }),
        ];
        const cards = buildCards([], [], [], rows, makePatient());
        const card = cards.find((c) => c.type === 'allergies');
        expect(card.flagged).toBe(false);
    });

    it('allergies: falls back to patient.allergies when table is empty', () => {
        const cards = buildCards([], [], [], [], [], makePatient({ allergies: 'Penicillin, Latex' }));
        const card = cards.find((c) => c.type === 'allergies');
        expect(card).toBeTruthy();
        expect(card.preview).toBe('Penicillin, Latex');
    });

    it('allergies: does not use patient.allergies fallback when table has rows', () => {
        const rows = [makeAllergyRow({ allergen: 'Aspirin' })];
        const cards = buildCards([], [], [], rows, makePatient({ allergies: 'Should not appear' }));
        const card = cards.find((c) => c.type === 'allergies');
        expect(card.preview).not.toContain('Should not appear');
        expect(card.preview).toContain('Aspirin');
    });

    it('allergies: no card when table is empty and patient has no allergies', () => {
        const cards = buildCards([], [], [], [], [], makePatient({ allergies: null }));
        expect(cards.find((c) => c.type === 'allergies')).toBeUndefined();
    });

    // ── Safety Info ──────────────────────────────────────────────────────────────

    it('builds safety_info card from safety_info table rows', () => {
        const row = makeSafetyRow();
        const cards = buildCards([], [], [], [], [row], makePatient());
        const card = cards.find((c) => c.type === 'safety_info');
        expect(card).toBeTruthy();
        expect(card.hasData).toBe(true);
    });

    it('safety_info: preview shows deduplicated safety_flag values', () => {
        const rows = [
            makeSafetyRow({ safety_flag: 'fall_risk' }),
            makeSafetyRow({ safety_flag: 'isolation' }),
        ];
        const cards = buildCards([], [], [], [], rows, makePatient());
        const card = cards.find((c) => c.type === 'safety_info');
        expect(card.preview).toBe('fall_risk, isolation');
    });

    it('safety_info: deduplicates repeated flags in preview', () => {
        const rows = [
            makeSafetyRow({ safety_flag: 'fall_risk' }),
            makeSafetyRow({ safety_flag: 'fall_risk' }),
        ];
        const cards = buildCards([], [], [], [], rows, makePatient());
        const card = cards.find((c) => c.type === 'safety_info');
        expect(card.preview).toBe('fall_risk');
    });

    it('safety_info: flagged=true whenever table rows are present', () => {
        const row = makeSafetyRow();
        const cards = buildCards([], [], [], [], [row], makePatient());
        const card = cards.find((c) => c.type === 'safety_info');
        expect(card.flagged).toBe(true);
    });

    it('safety_info: falls back to patient.notes when table is empty', () => {
        const cards = buildCards([], [], [], [], [], makePatient({ notes: 'Fall risk' }));
        const card = cards.find((c) => c.type === 'safety_info');
        expect(card).toBeTruthy();
        expect(card.preview).toBe('Fall risk');
        expect(card.flagged).toBe(true);
    });

    it('safety_info: does not use patient.notes fallback when table has rows', () => {
        const rows = [makeSafetyRow({ safety_flag: 'isolation' })];
        const cards = buildCards([], [], [], [], rows, makePatient({ notes: 'Should not appear' }));
        const card = cards.find((c) => c.type === 'safety_info');
        expect(card.preview).not.toContain('Should not appear');
        expect(card.preview).toContain('isolation');
    });

    it('safety_info: no card when table is empty and patient has no notes', () => {
        const cards = buildCards([], [], [], [], [], makePatient({ notes: null }));
        expect(cards.find((c) => c.type === 'safety_info')).toBeUndefined();
    });

    it('non-safety cards default flagged=false and confidence=1.0', () => {
        const med   = makeMedRow({ medication_name: 'Aspirin', next_due: '2026-04-19T14:00:00.000Z' });
        const vital = makeVitalRow();
        const seg   = makeSegment({ transcript: 'Stable' });
        // No safety_info rows and no patient.notes → no safety card emitted
        const cards = buildCards([seg], [med], [vital], [], [], makePatient());
        for (const card of cards) {
            expect(card.flagged).toBe(false);
            expect(card.confidence).toBe(1.0);
        }
    });

    it('skips segments with malformed structured_json without throwing', () => {
        const seg = makeSegment({ structured_json: '{bad json}' });
        expect(() => buildCards([seg], [], [], [], [], makePatient())).not.toThrow();
    });

    it('filters out segments whose bed_id does not match patient.id (recent_activity only from owned beds)', () => {
        const seg = makeSegment({ bed_id: 'other-patient', transcript: 'Some activity' });
        const cards = buildCards([seg], [], [], [], [], makePatient({ id: 'p-1' }));
        expect(cards.find((c) => c.type === 'recent_activity')).toBeUndefined();
    });

    it('includes segments with null bed_id in recent_activity (unassigned segments)', () => {
        const seg = makeSegment({ bed_id: null, transcript: 'Unassigned observation' });
        const cards = buildCards([seg], [], [], [], [], makePatient({ id: 'p-1' }));
        expect(cards.find((c) => c.type === 'recent_activity')).toBeTruthy();
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

// ─── onMicPress — patient context flows into the voice pipeline ───────────────

describe('onMicPress', () => {
    beforeEach(async () => {
        // Clear call history so not.toHaveBeenCalled() is scoped to the current test
        jest.clearAllMocks();
        SessionService.getActiveShift.mockResolvedValue(null);
        SessionService.getActiveSessionId.mockResolvedValue(null);
        const storage = await getStorage();
        storage.queryBySession.mockResolvedValue([]);
        storage.queryBySessionAndBed.mockResolvedValue([]);
    });

    it('calls toggleRecording with sessionId and patient.id', async () => {
        SessionService.getActiveSessionId.mockResolvedValue('session-abc');

        const patient = makePatient({ id: 'p-1' });
        const view = makeView();
        const p = new PatientDetailsPresenter(view);
        // mount() sets this._patient so onMicPress has the context
        await p.mount({ patient, sessionId: 'session-abc' });

        await p.onMicPress();

        expect(ContinuousRecordingService.toggleRecording).toHaveBeenCalledWith(
            'session-abc',
            'p-1'
        );
    });

    it('passes null patientId when patient has no id', async () => {
        SessionService.getActiveSessionId.mockResolvedValue('session-abc');

        const patient = makePatient({ id: null });
        const view = makeView();
        const p = new PatientDetailsPresenter(view);
        await p.mount({ patient, sessionId: 'session-abc' });

        await p.onMicPress();

        expect(ContinuousRecordingService.toggleRecording).toHaveBeenCalledWith(
            'session-abc',
            null
        );
    });

    it('does not call toggleRecording when there is no active session', async () => {
        SessionService.getActiveSessionId.mockResolvedValue(null);

        const view = makeView();
        const p = new PatientDetailsPresenter(view);
        await p.mount({ patient: makePatient(), sessionId: null });

        await p.onMicPress();

        expect(ContinuousRecordingService.toggleRecording).not.toHaveBeenCalled();
    });

    it('passes the patient.id from mount — not a stale value from a previous screen', async () => {
        SessionService.getActiveSessionId.mockResolvedValue('session-xyz');

        // Simulate a fresh mount for a specific patient (Bed 4 — Dave)
        const patient = makePatient({ id: 'p-dave', bed: '4', name: 'Dave' });
        const view = makeView();
        const p = new PatientDetailsPresenter(view);
        await p.mount({ patient, sessionId: 'session-xyz' });

        await p.onMicPress();

        // The recording must be tagged with Dave's id, not a default or null
        const [calledSessionId, calledPatientId] = ContinuousRecordingService.toggleRecording.mock.calls[0];
        expect(calledSessionId).toBe('session-xyz');
        expect(calledPatientId).toBe('p-dave');
    });
});

// ─── onCardPress ──────────────────────────────────────────────────────────────

describe('onCardPress', () => {
    function makeNav() { return { navigate: jest.fn() }; }

    it('navigates to CardDetail for a non-flagged card with data', () => {
        const p = new PatientDetailsPresenter(makeView());
        p._patient = makePatient();
        const nav = makeNav();
        const card = { type: 'medications', hasData: true, flagged: false };
        p.onCardPress(card, nav);
        expect(nav.navigate).toHaveBeenCalledWith('CardDetail', { card, patient: p._patient });
    });

    it('navigates to CardCorrection for a flagged card', () => {
        const p = new PatientDetailsPresenter(makeView());
        p._patient = makePatient();
        const nav = makeNav();
        const card = { type: 'safety_info', hasData: true, flagged: true };
        p.onCardPress(card, nav);
        expect(nav.navigate).toHaveBeenCalledWith('CardCorrection', { card, patient: p._patient });
    });

    it('does not navigate when card has no data', () => {
        const p = new PatientDetailsPresenter(makeView());
        p._patient = makePatient();
        const nav = makeNav();
        p.onCardPress({ type: 'medications', hasData: false, flagged: false }, nav);
        expect(nav.navigate).not.toHaveBeenCalled();
    });

    it('passes the current patient to the navigation params', () => {
        const patient = makePatient({ id: 'p-42', name: 'Bob' });
        const p = new PatientDetailsPresenter(makeView());
        p._patient = patient;
        const nav = makeNav();
        const card = { type: 'vital_signs', hasData: true, flagged: false };
        p.onCardPress(card, nav);
        expect(nav.navigate.mock.calls[0][1].patient).toBe(patient);
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
        storage.queryBySessionAndBed.mockResolvedValue([]);

        const view = makeView();
        const p = new PatientDetailsPresenter(view);
        await p.mount({ patient: makePatient(), sessionId: 'session-abc' });
        p.unmount();

        expect(unsub).toHaveBeenCalled();
    });
});