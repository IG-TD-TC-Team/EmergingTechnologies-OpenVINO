import { Platform } from 'react-native';
import AudioSourceResolver from '../services/audio/AudioSourceResolver';
import ContinuousRecordingService from '../services/audio/ContinuousRecordingService';
import WebRecorderService from '../services/audio/WebRecorderService';
import SessionService from '../services/SessionService';
import { getStorage } from '../repositories';

export default class PatientDetailsPresenter {
    constructor(view) {
        this._view = view;
        this._patient = null;
        this._sessionId = null;
        this._unsubRecording = null;
        this._pollInterval = null;
        this._lastCardKeys = null;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async mount({ patient, sessionId }) {
        this._patient = patient;
        this._sessionId = sessionId;

        await this._resolveAudioSource();
        await this._loadSessionCard();
        await this._loadCards();

        this._unsubRecording = ContinuousRecordingService.subscribe(({ isRecording, connectionStatus }) => {
            this._view.setRecording(isRecording);
            this._view.setConnectionStatus(connectionStatus);
        });
        this._view.setRecording(ContinuousRecordingService.isRecording());

        if (Platform.OS === 'web') {
            this._view.setBrowserSupported(WebRecorderService.isSupported());
        }

        this._pollInterval = setInterval(() => this._loadCards(), 5000);
    }

    unmount() {
        if (this._unsubRecording) this._unsubRecording();
        if (this._pollInterval) clearInterval(this._pollInterval);
        AudioSourceResolver.resetOverride();
    }

    // ─── Audio source ─────────────────────────────────────────────────────────

    async _resolveAudioSource() {
        const strategy = await AudioSourceResolver.resolve();
        const available = await AudioSourceResolver.getAvailableSources();
        this._view.setAudioSource({
            sourceKey: strategy.getSourceKey(),
            sourceLabel: strategy.getSourceLabel(),
            canToggle: available.length > 1,
        });
    }

    async onToggleSource() {
        const strategy = await AudioSourceResolver.toggle();
        const available = await AudioSourceResolver.getAvailableSources();
        this._view.setAudioSource({
            sourceKey: strategy.getSourceKey(),
            sourceLabel: strategy.getSourceLabel(),
            canToggle: available.length > 1,
        });
    }

    // ─── Session card ─────────────────────────────────────────────────────────

    async _loadSessionCard() {
        try {
            const session = await SessionService.getActiveShift();
            if (!session) {
                this._view.setSessionCard(null);
                return;
            }
            // expires_at on the session record is set by the repository (BaseEntity TTL).
            // Fall back to started_at + 14h if the field is null.
            const expiresAt = session.expires_at
                ?? new Date(new Date(session.started_at).getTime() + 14 * 60 * 60 * 1000).toISOString();
            this._view.setSessionCard({ startedAt: session.started_at, expiresAt });
        } catch (e) {
            console.error('[PatientDetailsPresenter] Failed to load session card:', e);
            this._view.setSessionCard(null);
        }
    }

    // ─── Info cards ───────────────────────────────────────────────────────────

    async _loadCards() {
        try {
            if (!this._sessionId) {
                this._view.setCards([]);
                return;
            }

            const storage = await getStorage();
            const bedId = this._patient?.id ?? null;

            const [allSegments, medications] = await Promise.all([
                storage.queryBySession('transcription_segments', this._sessionId),
                bedId
                    ? storage.queryBySessionAndBed('medications', this._sessionId, bedId)
                    : Promise.resolve([]),
            ]);

            const cards = buildCards(allSegments, medications, this._patient);

            // Only call setCards when something actually changed to avoid spurious re-renders
            const keys = JSON.stringify(cards.map((c) => `${c.type}:${c.preview}`));
            if (keys !== this._lastCardKeys) {
                this._lastCardKeys = keys;
                this._view.setCards(cards);
            }
        } catch (e) {
            console.error('[PatientDetailsPresenter] Failed to load cards:', e);
            this._view.setCards([]);
        }
    }

    // ─── Mic ─────────────────────────────────────────────────────────────────

    async onMicPress() {
        const sessionId = await SessionService.getActiveSessionId();
        if (!sessionId) return;
        try {
            await ContinuousRecordingService.toggleRecording(sessionId, this._patient?.id ?? null);
        } catch (err) {
            console.error('[PatientDetailsPresenter] Failed to toggle recording:', err);
        }
    }

    // ─── Card navigation (stub — detail screens are US11/US19/US22) ──────────

    onCardPress(card, _navigation) {
        // TODO US11/US19/US22: navigate to Detail View or Edit/Correction screen
        console.log('[PatientDetailsPresenter] card tapped:', card.type);
    }
}

// ─── Pure helper — builds ordered card array ──────────────────────────────────

/**
 * Build the ordered card array for the patient details screen.
 *
 * @param {object[]} segments   - transcription_segments rows for this session
 * @param {object[]} medications - rows from the medications card store,
 *                                 pre-scoped to (session_id, bed_id) by the caller
 * @param {object}   patient    - patient record (for allergies / notes fallback)
 */
export function buildCards(segments, medications, patient) {
    // Filter to this patient's bed; segments with no bed_id are treated as unassigned (included)
    const owned = segments.filter((s) => s.bed_id === null || s.bed_id === patient.id);

    const parsed = owned.map((s) => {
        let structured = null;
        try {
            if (s.structured_json) structured = JSON.parse(s.structured_json);
        } catch (_) {}
        return { ...s, structured };
    });

    // Defaults applied to every card so US22 can set flagged/confidence without touching the view
    const card = (fields) => ({ flagged: false, confidence: 1.0, ...fields });

    // Sort oldest → newest for aggregation
    const byTime = [...parsed].sort((a, b) => (a.ts_start ?? 0) - (b.ts_start ?? 0));
    const latest = byTime[byTime.length - 1] ?? null;

    const cards = [];

    // 2 — Recent Activity
    if (latest && (latest.structured?.activity_type || latest.transcript)) {
        const ts = latest.ts_start
            ? new Date(latest.ts_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : null;
        const activityType = latest.structured?.activity_type ?? null;
        cards.push(card({
            type: 'recent_activity',
            hasData: true,
            preview: [
                ts ? `${ts}` : null,
                activityType ?? (latest.language ? `Language: ${latest.language}` : null),
            ].filter(Boolean).join('  ·  '),
            activityType,
            transcript: latest.transcript ?? null,
        }));
    }

    // 3 — Medications (from dedicated card store — Task 2/3)
    //
    // medications rows are pre-scoped to (session_id, bed_id) and sorted newest-first
    // by queryBySessionAndBed. We deduplicate by medication_name (keeping the most
    // recently captured entry), then sort ascending by next_due for display.
    if (medications.length > 0) {
        // Deduplicate: first occurrence wins (rows arrive newest-first from the DB)
        const seen = new Map();
        for (const med of medications) {
            if (!seen.has(med.medication_name)) seen.set(med.medication_name, med);
        }
        // Sort ascending by next_due (ISO strings compare lexicographically)
        const sorted = [...seen.values()].sort((a, b) =>
            (a.next_due ?? '').localeCompare(b.next_due ?? '')
        );
        // Preview: "Paracetamol — due 14:30" or first two joined with ", "
        const fmt = (med) => {
            const time = med.next_due
                ? new Date(med.next_due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : null;
            return time ? `${med.medication_name} — due ${time}` : med.medication_name;
        };
        cards.push(card({
            type: 'medications',
            hasData: true,
            preview: sorted.slice(0, 2).map(fmt).join(', '),
            items: sorted,
        }));
    }

    // 4 — Next Reminder (from actions)
    const actions = [];
    for (const s of byTime) {
        const list = s.structured?.actions;
        if (Array.isArray(list)) {
            for (const a of list) {
                if (a && !actions.includes(a)) actions.push(a);
            }
        }
    }
    if (actions.length > 0) {
        cards.push(card({
            type: 'next_reminder',
            hasData: true,
            preview: actions[0],
            items: actions,
        }));
    }

    // 5 — Vital Signs (latest segment that has vitals)
    const vitalsSegment = [...byTime].reverse().find((s) => s.structured?.vitals);
    if (vitalsSegment) {
        const v = vitalsSegment.structured.vitals;
        const parts = Object.entries(v)
            .filter(([, val]) => val != null)
            .map(([key, val]) => `${key}: ${val}`)
            .slice(0, 3);
        cards.push(card({
            type: 'vital_signs',
            hasData: true,
            preview: parts.join('  ·  '),
            data: v,
        }));
    }

    // 6 — Allergies (from patient record)
    if (patient?.allergies) {
        cards.push(card({
            type: 'allergies',
            hasData: true,
            preview: typeof patient.allergies === 'string'
                ? patient.allergies
                : JSON.stringify(patient.allergies),
        }));
    }

    // 7 — Safety Information (from patient notes)
    if (patient?.notes) {
        cards.push(card({
            type: 'safety_info',
            hasData: true,
            preview: typeof patient.notes === 'string'
                ? patient.notes
                : JSON.stringify(patient.notes),
        }));
    }

    return cards;
}