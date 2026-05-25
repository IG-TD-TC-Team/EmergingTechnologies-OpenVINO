/**
 * CardDetailPresenter — US11
 *
 * Tests:
 *   mount — resolves audio source, sets metadata and narrative from card
 *   _deriveMetadata — "Today HH:MM" for valid ts_start; "Today –" when null; language passthrough
 *   onCopyPress — calls Clipboard.setStringAsync with sections text, then showCopyToast
 *   onCopyPress — falls back to transcript when no sections
 *   onCopyPress — empty string when card has neither
 *   onEditPress — does not throw (stub for US19)
 *   unmount — calls AudioSourceResolver.resetOverride
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('expo-clipboard', () => ({
    setStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../repositories/PatientRepository', () => ({
    PatientRepository: jest.fn().mockImplementation(() => ({
        get: jest.fn().mockResolvedValue(null),
    })),
}));

jest.mock('../../services/audio/AudioSourceResolver', () => ({
    __esModule: true,
    default: {
        resolve: jest.fn().mockResolvedValue({
            getSourceKey:   () => 'builtin',
            getSourceLabel: () => 'Built-in mic',
        }),
        getAvailableSources: jest.fn().mockResolvedValue([]),
        toggle:              jest.fn().mockResolvedValue({
            getSourceKey:   () => 'usb',
            getSourceLabel: () => 'USB mic',
        }),
        resetOverride: jest.fn(),
    },
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import CardDetailPresenter from '../../presenters/CardDetailPresenter';
import * as Clipboard from 'expo-clipboard';
import AudioSourceResolver from '../../services/audio/AudioSourceResolver';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeView() {
    return {
        setAudioSource:  jest.fn(),
        setMetadata:     jest.fn(),
        setNarrative:    jest.fn(),
        setIsEdited:     jest.fn(),
        showCopyToast:   jest.fn(),
    };
}

function makePatient(overrides = {}) {
    return { id: 'p-1', bed: '1', name: 'Alice', ...overrides };
}

function makeCard(overrides = {}) {
    return {
        type:         'recent_activity',
        hasData:      true,
        flagged:      false,
        activityType: 'Pain assessment',
        transcript:   'Patient reports pain at wound site.',
        language:     'fr',
        ts_start:     new Date('2026-05-01T14:10:00.000Z').getTime(),
        sections:     null,
        ...overrides,
    };
}

// ─── mount ────────────────────────────────────────────────────────────────────

describe('mount', () => {
    it('resolves audio source and calls setAudioSource', async () => {
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card: makeCard(), patient: makePatient() });
        expect(view.setAudioSource).toHaveBeenCalledWith(
            expect.objectContaining({ sourceKey: 'builtin', sourceLabel: 'Built-in mic' })
        );
    });

    it('calls setNarrative with transcript and sections from card', async () => {
        const card = makeCard({ transcript: 'Some text', sections: null });
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card, patient: makePatient() });
        expect(view.setNarrative).toHaveBeenCalledWith({ transcript: 'Some text', sections: null });
    });

    it('calls setNarrative with sections when card has them', async () => {
        const sections = [{ header: 'Assessment', body: 'Patient stable.' }];
        const card = makeCard({ sections });
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card, patient: makePatient() });
        expect(view.setNarrative).toHaveBeenCalledWith({ transcript: card.transcript, sections });
    });

    it('calls setMetadata with derived timeLabel and language', async () => {
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card: makeCard(), patient: makePatient() });
        const call = view.setMetadata.mock.calls[0][0];
        expect(call.timeLabel).toMatch(/^Today \d{1,2}:\d{2}/);
        expect(call.language).toBe('fr');
    });
});

// ─── _deriveMetadata ──────────────────────────────────────────────────────────

describe('_deriveMetadata', () => {
    const p = new CardDetailPresenter(makeView());

    it('returns "Today HH:MM" when ts_start is set', () => {
        const ts = new Date('2026-05-01T14:10:00.000Z').getTime();
        const { timeLabel } = p._deriveMetadata(ts, 'fr');
        expect(timeLabel).toMatch(/^Today \d{1,2}:\d{2}/);
    });

    it('returns "Today –" when ts_start is null', () => {
        const { timeLabel } = p._deriveMetadata(null, 'fr');
        expect(timeLabel).toBe('Today –');
    });

    it('returns "Today –" when ts_start is undefined', () => {
        const { timeLabel } = p._deriveMetadata(undefined, null);
        expect(timeLabel).toBe('Today –');
    });

    it('passes language through', () => {
        const { language } = p._deriveMetadata(null, 'en');
        expect(language).toBe('en');
    });

    it('returns "–" when language is null', () => {
        const { language } = p._deriveMetadata(null, null);
        expect(language).toBe('–');
    });
});

// ─── onCopyPress ──────────────────────────────────────────────────────────────

describe('onCopyPress', () => {
    it('calls Clipboard.setStringAsync with sections text when sections present', async () => {
        const sections = [
            { header: 'Assessment', body: 'Patient reports fatigue.' },
            { header: 'Plan',       body: 'Monitor vital signs.' },
        ];
        const card = makeCard({ sections, transcript: 'raw' });
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card, patient: makePatient() });
        await p.onCopyPress();
        expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
            'Assessment\nPatient reports fatigue.\n\nPlan\nMonitor vital signs.'
        );
    });

    it('falls back to transcript when sections is null', async () => {
        const card = makeCard({ sections: null, transcript: 'Plain transcript text.' });
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card, patient: makePatient() });
        await p.onCopyPress();
        expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Plain transcript text.');
    });

    it('copies empty string when both sections and transcript are null', async () => {
        const card = makeCard({ sections: null, transcript: null });
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card, patient: makePatient() });
        await p.onCopyPress();
        expect(Clipboard.setStringAsync).toHaveBeenCalledWith('');
    });

    it('calls showCopyToast after copying', async () => {
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card: makeCard(), patient: makePatient() });
        await p.onCopyPress();
        expect(view.showCopyToast).toHaveBeenCalled();
    });
});

// ─── onEditPress ──────────────────────────────────────────────────────────────

describe('onEditPress', () => {
    it('does not throw when navigation is absent', async () => {
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card: makeCard(), patient: makePatient() });
        expect(() => p.onEditPress()).not.toThrow();
    });

    it('navigates to EditPatient with currentValue pre-populated from _buildCopyText (recent_activity)', async () => {
        const navigation = { navigate: jest.fn() };
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card: makeCard(), patient: makePatient(), navigation });
        p.onEditPress();
        expect(navigation.navigate).toHaveBeenCalledWith(
            'EditPatient',
            expect.objectContaining({
                patientId:    'p-1',
                fieldKey:     'recent_activity',
                // recent_activity with no sections/segments falls back to transcript
                currentValue: 'Patient reports pain at wound site.',
            })
        );
    });

    it('pre-populates vital_signs card with formatted vitals text (not blank)', async () => {
        const navigation = { navigate: jest.fn() };
        const card = makeCard({
            type:       'vital_signs',
            transcript: null,
            sections:   null,
            data: {
                blood_pressure: '120/80',
                heart_rate:     72,
                temperature:    null,
                spo2:           null,
            },
        });
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card, patient: makePatient(), navigation });
        p.onEditPress();
        const { currentValue } = navigation.navigate.mock.calls[0][1];
        expect(currentValue).toContain('Blood Pressure: 120/80');
        expect(currentValue).toContain('Heart Rate: 72');
    });
});

// ─── unmount ──────────────────────────────────────────────────────────────────

describe('unmount', () => {
    it('calls AudioSourceResolver.resetOverride', async () => {
        const view = makeView();
        const p = new CardDetailPresenter(view);
        await p.mount({ card: makeCard(), patient: makePatient() });
        p.unmount();
        expect(AudioSourceResolver.resetOverride).toHaveBeenCalled();
    });
});