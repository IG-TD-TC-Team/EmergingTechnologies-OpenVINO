/**
 * DashboardPresenter
 *
 * Owns all business logic for the Dashboard screen.
 *
 * view interface:
 *   setAudioSource({ sourceKey, sourceLabel, canToggle })
 *   setMicStatus(status)
 *   setRecording(isRecording)
 *   setBeds(beds)         — array of { id, bed, name, status }
 *   setBedsLoading(bool)  — loading state for bed grid
 */

import { AppState } from 'react-native';
import AudioSourceResolver from '../services/audio/AudioSourceResolver';
import PermissionsService from '../services/PermissionsService';
import SessionService from '../services/SessionService';
import { getStorage } from '../repositories';

export default class DashboardPresenter {
    constructor(view) {
        this._view = view;
        this._interval = null;
        this._appStateSub = null;
        this._isRecording = false;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async mount() {
        await this._resolveAudioSource();
        await this._checkPermission();
        await this._loadBeds();

        // Poll every 3s — detects plug/unplug and resets override if USB gone
        this._interval = setInterval(() => this._resolveAudioSource(), 3000);

        this._appStateSub = AppState.addEventListener('change', (next) => {
            if (next === 'active') {
                this._resolveAudioSource();
                this._checkPermission();
            }
        });
    }

    unmount() {
        if (this._interval) clearInterval(this._interval);
        if (this._appStateSub) this._appStateSub.remove();
        AudioSourceResolver.resetOverride();
    }

    // ─── Audio source ─────────────────────────────────────────────────────────

    async _resolveAudioSource() {
        const strategy = await AudioSourceResolver.resolve();
        const available = await AudioSourceResolver.getAvailableSources();

        this._view.setAudioSource({
            sourceKey: strategy.getSourceKey(),
            sourceLabel: strategy.getSourceLabel(),
            canToggle: available.length > 1, // only show toggle if USB is connected
        });
    }

    /**
     * Called when nurse taps the audio source badge.
     * Toggles between USB-C and built-in mic.
     */
    async onToggleSource() {
        const strategy = await AudioSourceResolver.toggle();
        const available = await AudioSourceResolver.getAvailableSources();

        this._view.setAudioSource({
            sourceKey: strategy.getSourceKey(),
            sourceLabel: strategy.getSourceLabel(),
            canToggle: available.length > 1,
        });
    }

    // ─── Permissions ──────────────────────────────────────────────────────────

    async _checkPermission() {
        const status = await PermissionsService.check();
        this._view.setMicStatus(status);
    }

    async onMicPress() {
        const status = await PermissionsService.ensure();
        this._view.setMicStatus(status);
        if (status !== 'granted') return;
        this._isRecording = !this._isRecording;
        this._view.setRecording(this._isRecording);
    }

    async onRequestPermission() {
        const status = await PermissionsService.request();
        this._view.setMicStatus(status);
    }

    async onOpenSettings() {
        await PermissionsService.openSettings();
    }

    // ─── Bed mapping ─────────────────────────────────────────────────────────

    async _loadBeds() {
        this._view.setBedsLoading(true);
        try {
            const sessionId = await SessionService.getActiveSessionId();
            if (!sessionId) {
                this._view.setBeds([]);
                return;
            }

            const storage = await getStorage();
            let patients = await storage.queryBySession('patients', sessionId);

            if (patients.length === 0) {
                await this._seedExamplePatients(storage, sessionId);
                patients = await storage.queryBySession('patients', sessionId);
            }

            const beds = patients.map((p) => ({
                id: p.id,
                bed: p.bed,
                name: p.name,
                status: p.status,
            }));

            this._view.setBeds(beds);
        } catch (e) {
            console.error('[DashboardPresenter] Failed to load beds:', e);
            this._view.setBeds([]);
        } finally {
            this._view.setBedsLoading(false);
        }
    }

    async _seedExamplePatients(storage, sessionId) {
        const now = new Date().toISOString();
        const basePatient = {
            session_id: sessionId,
            mrn: null,
            date_of_birth: null,
            status: 'active',
            diagnosis: null,
            allergies: null,
            medications: null,
            notes: null,
            last_interaction_at: now,
            note_count: 0,
            recording_count: 0,
        };

        await storage.create('patients', { ...basePatient, name: 'Alice', bed: '1' });
        await storage.create('patients', { ...basePatient, name: 'Bob', bed: '2' });
    }

    onBedPress(patient, navigation) {
        navigation.navigate('BedDetails', { patient });
    }
}