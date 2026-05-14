import * as Clipboard from 'expo-clipboard';
import { PatientRepository } from '../repositories/PatientRepository';
import AudioSourceResolver from '../services/audio/AudioSourceResolver';

export default class CardDetailPresenter {
    constructor(view) {
        this._view       = view;
        this._patient    = null;
        this._card       = null;
        this._navigation = null;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async mount({ card, patient, navigation = null }) {
        this._card       = card;
        this._patient    = patient;
        this._navigation = navigation;

        await this._resolveAudioSource();
        // Use data.timestamp as fallback for vital-sign cards which have no ts_start
        const tsStart = card.ts_start ?? card.data?.timestamp ?? null;
        this._view.setMetadata(this._deriveMetadata(tsStart, card.language ?? null));

        this._view.setNarrative({
            transcript: card.transcript ?? null,
            sections:   card.sections ?? null,
        });

        await this.checkEditStatus();
    }

    unmount() {
        AudioSourceResolver.resetOverride();
    }

    // ─── Audio source ─────────────────────────────────────────────────────────

    async _resolveAudioSource() {
        const strategy  = await AudioSourceResolver.resolve();
        const available = await AudioSourceResolver.getAvailableSources();
        this._view.setAudioSource({
            sourceKey:  strategy.getSourceKey(),
            sourceLabel: strategy.getSourceLabel(),
            canToggle:  available.length > 1,
        });
    }

    async onToggleSource() {
        const strategy  = await AudioSourceResolver.toggle();
        const available = await AudioSourceResolver.getAvailableSources();
        this._view.setAudioSource({
            sourceKey:  strategy.getSourceKey(),
            sourceLabel: strategy.getSourceLabel(),
            canToggle:  available.length > 1,
        });
    }

    // ─── Metadata ─────────────────────────────────────────────────────────────

    _deriveMetadata(tsStart, language) {
        let timeLabel = 'Today –';
        if (tsStart) {
            const time = new Date(tsStart).toLocaleTimeString([], {
                hour:   '2-digit',
                minute: '2-digit',
            });
            timeLabel = `Today ${time}`;
        }
        return {
            timeLabel,
            language: language ?? '–',
        };
    }

    // ─── Actions ──────────────────────────────────────────────────────────────

    async onCopyPress() {
        const text = this._buildCopyText();
        await Clipboard.setStringAsync(text);
        this._view.showCopyToast();
    }

    // Queries edit status from PatientRepository and updates the view.
    // Called on mount and again whenever CardDetailScreen regains focus.
    async checkEditStatus() {
        if (!this._patient?.id) return;
        try {
            const repo    = new PatientRepository();
            const record  = await repo.get(this._patient.id);
            const fieldKey = this._card?.type ?? 'recent_activity';
            const field   = record?.fields?.find((f) => f.key === fieldKey);
            this._view.setIsEdited?.(!!field?.edited_by);
        } catch (_) {}
    }

    onEditPress() {
        if (!this._navigation) return;
        this._navigation.navigate('EditPatient', {
            patientId:    this._patient?.id ?? '',
            fieldKey:     this._card?.type ?? 'recent_activity',
            currentValue: this._buildCopyText(),
        });
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    _buildCopyText() {
        const card = this._card;
        if (!card) return '';

        if (card.type === 'vital_signs' && card.data) {
            const d = card.data;
            const parts = [];
            if (d.blood_pressure != null) parts.push(`Blood Pressure: ${d.blood_pressure} mmHg`);
            if (d.heart_rate     != null) parts.push(`Heart Rate: ${d.heart_rate} bpm`);
            if (d.temperature    != null) parts.push(`Temperature: ${d.temperature} °C`);
            if (d.spo2           != null) parts.push(`SpO2: ${d.spo2}%`);
            return parts.join('\n');
        }

        if (card.type === 'next_reminder' && Array.isArray(card.items)) {
            return card.items.join('\n');
        }

        if (card.type === 'medications' && Array.isArray(card.items)) {
            return card.items
                .map((m) => [m.medication_name, m.dose, m.frequency].filter(Boolean).join(' — '))
                .join('\n');
        }

        if (card.type === 'allergies' && Array.isArray(card.items)) {
            return card.items
                .map((a) => [a.allergen, a.severity].filter(Boolean).join(' — '))
                .join('\n');
        }

        // recent_activity — full conversation if available
        if (Array.isArray(card.segments) && card.segments.length > 0) {
            return card.segments.map((s) => s.transcript).join('\n\n');
        }
        if (Array.isArray(card.sections) && card.sections.length > 0) {
            return card.sections.map((s) => `${s.header}\n${s.body}`).join('\n\n');
        }
        return card.transcript ?? '';
    }
}