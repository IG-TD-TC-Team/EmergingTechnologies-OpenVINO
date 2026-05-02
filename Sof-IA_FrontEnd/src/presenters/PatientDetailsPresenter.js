import { Platform } from 'react-native';
import AudioSourceResolver from '../services/audio/AudioSourceResolver';
import ContinuousRecordingService from '../services/audio/ContinuousRecordingService';
import WebRecorderService from '../services/audio/WebRecorderService';
import SessionService from '../services/SessionService';
import { getStorage } from '../repositories';

// ─── Demo script (Alice, nurse-patient consultation only, BP 100/65) ──────────
// Cards are pushed directly to the view on a timer; no real recording is made.

function _buildDemoTimeline() {
    const now = new Date().toISOString();

    // Each segment represents one exchange in the conversation
    const seg = (transcript) => ({ ts_start: now, transcript, language: 'fr' });

    const s1 = seg('Patiente : Je dors pas bien. Le bébé mange toutes les 3h et la nuit était difficile.');
    const s2 = seg('Infirmier : C\'est normal en attendant que la lactation soit mise en place.');
    const s3 = seg('Patiente : J\'ai la tête qui tourne quand je me lève.');
    const s4 = seg('Infirmier : Je prends votre tension artérielle.\nTA systolique 100, diastolique 65.');
    const s5 = seg('Patiente : Les points de suture font mal. Est-ce qu\'on peut les regarder ?');

    // activity() builds a card from an accumulated list of segments
    const activity = (preview, segments) => ({
        type: 'recent_activity', hasData: true, flagged: false,
        ts_start: now, language: 'fr',
        preview,
        transcript: segments[segments.length - 1].transcript,
        segments,
    });

    const _EDUCATION_CARD = {
        type: 'next_reminder', hasData: true, flagged: false,
        ts_start: now, language: 'fr',
        preview: 'Allaitement toutes les 3h — normal en attente de montée laiteuse',
        items: ['Éducation fournie : fréquence d\'alimentation normale en attendant que la lactation soit mise en place.'],
    };

    const _VITALS_CARD = {
        type: 'vital_signs', hasData: true, flagged: false,
        ts_start: now, language: 'fr',
        preview: 'TA 100/65',
        data: { blood_pressure: '100/65', timestamp: now },
    };

    return [
        // Step 1 — patiente se plaint de fatigue / bébé mange toutes les 3h
        {
            delay: 8000,
            cards: [activity('14:10  ·  Fatigue post-partum', [s1])],
        },
        // Step 2 — infirmier explique que c'est normal → carte éducation + activité mise à jour
        {
            delay: 14000,
            cards: [
                activity('14:10  ·  Éducation allaitement', [s1, s2]),
                _EDUCATION_CARD,
            ],
        },
        // Step 3 — patiente : tête qui tourne en se levant → activité mise à jour
        {
            delay: 24000,
            cards: [
                activity('14:10  ·  Étourdissements à la lever', [s1, s2, s3]),
                _EDUCATION_CARD,
            ],
        },
        // Step 4 — prise TA → activité mise à jour + carte signes vitaux
        {
            delay: 33000,
            cards: [
                activity('14:10  ·  Prise TA', [s1, s2, s3, s4]),
                _EDUCATION_CARD,
                _VITALS_CARD,
            ],
        },
        // Step 5 — points de suture douloureux → activité mise à jour + alerte clinique
        {
            delay: 44000,
            cards: [
                activity('14:10  ·  Douleur — points de suture', [s1, s2, s3, s4, s5]),
                _EDUCATION_CARD,
                _VITALS_CARD,
                { type: 'safety_info', hasData: true, flagged: true,
                  preview: 'Douleur aux points de suture — à inspecter' },
            ],
        },
    ];
}

export default class PatientDetailsPresenter {
    constructor(view) {
        this._view = view;
        this._patient = null;
        this._sessionId = null;
        this._unsubRecording = null;
        this._pollInterval = null;
        this._lastCardKeys = null;
        this._isDemo = false;
        this._demoRunning = false;
        this._demoTimers = [];
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async mount({ patient, sessionId }) {
        this._patient = patient;
        this._sessionId = sessionId;
        this._isDemo = (patient?.name === 'Alice');

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
        this._clearDemoTimers();
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
        if (this._demoRunning) return;
        try {
            if (!this._sessionId) {
                this._view.setCards([]);
                return;
            }

            const storage = await getStorage();
            const bedId = this._patient?.id ?? null;

            const [allSegments, medications, vitalSigns, allergies, safetyInfo] = await Promise.all([
                storage.queryBySession('transcription_segments', this._sessionId),
                bedId
                    ? storage.queryBySessionAndBed('medications', this._sessionId, bedId)
                    : Promise.resolve([]),
                bedId
                    ? storage.queryBySessionAndBed('vital_signs', this._sessionId, bedId)
                    : Promise.resolve([]),
                bedId
                    ? storage.queryBySessionAndBed('allergies', this._sessionId, bedId)
                    : Promise.resolve([]),
                bedId
                    ? storage.queryBySessionAndBed('safety_info', this._sessionId, bedId)
                    : Promise.resolve([]),
            ]);

            const cards = buildCards(allSegments, medications, vitalSigns, allergies, safetyInfo, this._patient);

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

    // ─── Demo helpers ─────────────────────────────────────────────────────────

    _clearDemoTimers() {
        this._demoTimers.forEach(id => clearTimeout(id));
        this._demoTimers = [];
    }

    _startDemo() {
        this._demoRunning = true;
        this._view.setRecording(true);
        this._view.setCards([]);

        const timeline = _buildDemoTimeline();
        timeline.forEach(({ delay, cards }) => {
            const t = setTimeout(() => {
                if (!this._demoRunning) return;
                this._view.setCards(cards);
            }, delay);
            this._demoTimers.push(t);
        });

        // Auto-stop recording indicator after last card + 2s
        const lastDelay = timeline[timeline.length - 1].delay + 2000;
        const t = setTimeout(() => {
            this._demoRunning = false;
            this._view.setRecording(false);
        }, lastDelay);
        this._demoTimers.push(t);
    }

    _stopDemo() {
        this._clearDemoTimers();
        this._demoRunning = false;
        this._view.setRecording(false);
    }

    // ─── Mic ─────────────────────────────────────────────────────────────────

    async onMicPress() {
        if (this._isDemo) {
            if (this._demoRunning) {
                this._stopDemo();
            } else {
                this._startDemo();
            }
            return;
        }

        const sessionId = await SessionService.getActiveSessionId();
        if (!sessionId) return;
        try {
            await ContinuousRecordingService.toggleRecording(sessionId, this._patient?.id ?? null);
        } catch (err) {
            console.error('[PatientDetailsPresenter] Failed to toggle recording:', err);
        }
    }

    // ─── Card navigation (US11 = CardDetail, US19 = CardCorrection) ─────────

    onCardPress(card, navigation) {
        if (!card.hasData) return;
        if (card.flagged) {
            // Flagged → go straight to Correction screen (US19)
            navigation.navigate('CardCorrection', { card, patient: this._patient });
        } else {
            // Non-flagged with data → read-only Detail View with Edit button (US11)
            navigation.navigate('CardDetail', { card, patient: this._patient });
        }
    }
}

// ─── Pure helper — builds ordered card array ──────────────────────────────────

/**
 * Build the ordered card array for the patient details screen.
 *
 * @param {object[]} segments   - transcription_segments rows for this session
 * @param {object[]} medications - rows from the medications card store,
 *                                 pre-scoped to (session_id, bed_id) by the caller
 * @param {object[]} vitalSigns  - rows from the vital_signs card store,
 *                                 pre-scoped to (session_id, bed_id) by the caller
 * @param {object[]} allergies   - rows from the allergies card store,
 *                                 pre-scoped to (session_id, bed_id) by the caller
 * @param {object[]} safetyInfo  - rows from the safety_info card store,
 *                                 pre-scoped to (session_id, bed_id) by the caller
 * @param {object}   patient    - patient record (for allergies / notes fallback)
 */
export function buildCards(segments, medications, vitalSigns, allergies, safetyInfo, patient) {
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
        // LLM may return activity_type as an array or a comma-separated string
        const rawActivityType = latest.structured?.activity_type ?? null;
        const activityType = Array.isArray(rawActivityType)
            ? rawActivityType.join(', ')
            : rawActivityType;
        cards.push(card({
            type: 'recent_activity',
            hasData: true,
            preview: [
                ts ? `${ts}` : null,
                activityType ?? (latest.language ? `Language: ${latest.language}` : null),
            ].filter(Boolean).join('  ·  '),
            activityType,
            transcript: latest.transcript ?? null,
            language: latest.language ?? null,
            ts_start: latest.ts_start ?? null,
            sections: latest.structured?.sections ?? null,
            segments: byTime.map((s) => ({
                ts_start:   s.ts_start ?? null,
                transcript: s.transcript,
                language:   s.language,
            })),
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
            const name = med.medication_name || '—';
            let time = null;
            try {
                if (med.next_due) {
                    const d = new Date(med.next_due);
                    if (!isNaN(d)) time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
            } catch (_) {}
            return time ? `${name} — due ${time}` : name;
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

    // 5 — Vital Signs (from dedicated card store — Task 2/3)
    //
    // vitalSigns rows are pre-scoped to (session_id, bed_id). Take the row with
    // the latest measurement timestamp. Build preview from named spec fields,
    // omitting any that are null.  Format: "BP 120/80 — HR 72 — 09:15".
    if (vitalSigns.length > 0) {
        const latest = vitalSigns.reduce((best, row) =>
            (row.timestamp ?? '') > (best.timestamp ?? '') ? row : best
        );
        const parts = [];
        if (latest.blood_pressure != null) parts.push(`BP ${latest.blood_pressure}`);
        if (latest.heart_rate     != null) parts.push(`HR ${latest.heart_rate}`);
        if (latest.temperature    != null) parts.push(`T ${latest.temperature}°C`);
        if (latest.spo2           != null) parts.push(`SpO2 ${latest.spo2}%`);
        if (latest.timestamp) {
            parts.push(
                new Date(latest.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            );
        }
        cards.push(card({
            type: 'vital_signs',
            hasData: true,
            preview: parts.join(' — '),
            data: latest,
        }));
    }

    // 6 — Allergies (from dedicated card store; fall back to patient.allergies for existing shifts)
    if (allergies.length > 0) {
        const flagged = allergies.some((a) => {
            const s = (a.severity ?? '').toLowerCase();
            return s === 'severe' || s === 'critical' || s === 'high';
        });
        const names = [...new Set(allergies.map((a) => a.allergen))];
        cards.push(card({
            type: 'allergies',
            hasData: true,
            flagged,
            preview: names.join(', '),
            items: allergies,
        }));
    } else if (patient?.allergies) {
        cards.push(card({
            type: 'allergies',
            hasData: true,
            preview: typeof patient.allergies === 'string'
                ? patient.allergies
                : JSON.stringify(patient.allergies),
        }));
    }

    // 7 — Safety Information (from dedicated card store; fall back to patient.notes for existing shifts)
    // Safety cards are always flagged when present — they are always shown as red/orange per card spec.
    if (safetyInfo.length > 0) {
        const flags = [...new Set(safetyInfo.map((s) => s.safety_flag))];
        cards.push(card({
            type: 'safety_info',
            hasData: true,
            flagged: true,
            preview: flags.join(', '),
            items: safetyInfo,
        }));
    } else if (patient?.notes) {
        cards.push(card({
            type: 'safety_info',
            hasData: true,
            flagged: true,
            preview: typeof patient.notes === 'string'
                ? patient.notes
                : JSON.stringify(patient.notes),
        }));
    }

    return cards;
}