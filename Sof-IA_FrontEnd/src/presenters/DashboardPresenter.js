/**
 * DashboardPresenter
 *
 * Owns all business logic for the Dashboard screen.
 *
 * view interface:
 *   setAudioSource({ sourceKey, sourceLabel, canToggle })
 *   setMicStatus(status)
 *   setRecording(isRecording)
 *   setConnectionStatus('online' | 'offline-buffering')
 *   setBeds(beds)                    — array of { id, bed, name, status }
 *   setBedsLoading(bool)             — loading state for bed grid
 *   setTranscriptionSegments(segs)   — array of transcription_segments for active session (US11/US14)
 */

import { AppState, Platform } from 'react-native';
import AudioSourceResolver from '../services/audio/AudioSourceResolver';
import WebRecorderService from '../services/audio/WebRecorderService';
import ServiceWorkerManager from '../services/audio/ServiceWorkerManager';
import PermissionsService from '../services/PermissionsService';
import SessionService from '../services/SessionService';

import ContinuousRecordingService from '../services/audio/ContinuousRecordingService';
import EndShiftService from '../services/EndShiftService';
import { getStorage } from '../repositories';

export default class DashboardPresenter {
    constructor(view) {
        this._view = view;
        this._interval = null;
        this._appStateSub = null;

        this._unsubRecording = null;

        this._pendingNavigation = null;
        this._activePatient = null;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async mount() {
        await this._resolveAudioSource();
        await this._checkPermission();
        await this._loadBeds();
        await this._loadTranscriptionSegments();

        // Subscribe to recording state changes (isRecording, connectionStatus)
        this._unsubRecording = ContinuousRecordingService.subscribe(({ isRecording, connectionStatus }) => {
            this._view.setRecording(isRecording);
            this._view.setConnectionStatus(connectionStatus);
        });

        // Restore recording state if app was killed mid-recording
        await ContinuousRecordingService.initialize();

        // Sync initial recording state to view
        this._view.setRecording(ContinuousRecordingService.isRecording());

        // On web, tell the view whether this browser supports recording.
        // False for anything other than Chrome (no MediaRecorder / codec support).
        if (Platform.OS === 'web') {
            this._view.setBrowserSupported(WebRecorderService.isSupported());
        }

        // Register the Service Worker on web for background audio chunk uploads.
        if (WebRecorderService.isSupported()) {
            ServiceWorkerManager.register().catch(() => {});
        }

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
        if (this._unsubRecording) this._unsubRecording();
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

        const sessionId = await SessionService.getActiveSessionId();
        if (!sessionId) {
            console.warn('[DashboardPresenter] No active session — cannot toggle recording');
            return;
        }

        // Ensure an active patient exists before recording starts so bed_id is always set.
        // Auto-create only when starting (not stopping) and no bed is selected.
        if (!this._activePatient && !ContinuousRecordingService.isRecording()) {
            const patient = await this._autoCreatePatient();
            if (patient) {
                this._activePatient = { id: patient.id, name: patient.name, bed: patient.bed };
                this._view.setActivePatient(this._activePatient);
                await this._loadBeds();
            }
        }

        try {
            await ContinuousRecordingService.toggleRecording(sessionId, this._activePatient?.id ?? null);
        } catch (err) {
            console.error('[DashboardPresenter] Failed to toggle recording:', err);
            return;
        }
    }

    async _autoCreatePatient() {
        try {
            const sessionId = await SessionService.getActiveSessionId();
            if (!sessionId) return null;

            const storage = await getStorage();
            const existing = await storage.queryBySession('patients', sessionId);
            const nextBed = String(existing.length + 1);
            const now = new Date().toISOString();

            return await storage.create('patients', {
                session_id: sessionId,
                name: '',
                bed: nextBed,
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
            });
        } catch (e) {
            console.error('[DashboardPresenter] Failed to auto-create patient:', e);
            return null;
        }
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

    async _loadTranscriptionSegments() {
        try {
            const sessionId = await SessionService.getActiveSessionId();
            if (!sessionId) {
                this._view.setTranscriptionSegments([]);
                return;
            }

            const storage = await getStorage();
            const segments = await storage.queryBySession('transcription_segments', sessionId);
            this._view.setTranscriptionSegments(segments);
        } catch (e) {
            console.error('[DashboardPresenter] Failed to load transcription segments:', e);
            this._view.setTranscriptionSegments([]);
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

    // US21 — tap a bed card to set it as the active patient context, then open detail
    async onBedPress(patient, navigation) {
        this._activePatient = { id: patient.id, name: patient.name, bed: patient.bed };
        this._view.setActivePatient(this._activePatient);

        const sessionId = await SessionService.getActiveSessionId();
        try {
            const storage = await getStorage();
            const segments = sessionId
                ? await storage.queryBySession('transcription_segments', sessionId)
                : [];
            navigation.navigate('BedDetails', { patient, segments, sessionId });
        } catch (e) {
            console.error('[DashboardPresenter] onBedPress nav error:', e);
            navigation.navigate('BedDetails', { patient, segments: [], sessionId: null });
        }
    }

    // US21 — X button on the active patient chip resets context to none
    onClearActivePatient() {
        this._activePatient = null;
        this._view.setActivePatient(null);
    }

    /**
     * US21 — Returns hint fields to include in the transcription API request.
     * The API uses these as soft hints to improve structuration confidence;
     * they are not binding — the API can still detect other patients from speech.
     *
     * @returns {{ hint_patient_name?: string, hint_room?: string }}
     */
    getApiHints() {
        if (!this._activePatient) return {};
        return {
            hint_patient_name: this._activePatient.name,
            hint_room: this._activePatient.bed,
        };
    }

    // ─── End Shift ────────────────────────────────────────────────────────────

    onEndShift(_navigation) {
        this._view.setConfirmVisible(true);
    }

    onEndShiftCancel() {
        this._view.setConfirmVisible(false);
    }

    async onEndShiftConfirmed(navigation) {
        this._view.setConfirmVisible(false);
        this._view.setFlushSyncing(true);

        const flushed = await this._attemptQueueFlush();

        this._view.setFlushSyncing(false);

        if (flushed) {
            // Queue clear — proceed straight to cleanup (T5)
            await this._proceedWithCleanup(navigation);
        } else {
            // Still offline — let nurse decide
            this._pendingNavigation = navigation;
            this._view.setOfflineGateVisible(true);
        }
    }

    onOfflineGateWait() {
        this._view.setOfflineGateVisible(false);
        this._pendingNavigation = null;
    }

    async onOfflineGateForceDelete(navigation) {
        this._view.setOfflineGateVisible(false);
        await this._proceedWithCleanup(navigation);
    }

    async _attemptQueueFlush() {
        const sessionId = await SessionService.getActiveSessionId();
        if (!sessionId) return true;

        const { success } = await EndShiftService.flushQueue(sessionId);
        return success;
    }

    async _proceedWithCleanup(navigation) {
        this._pendingNavigation = null;

        const sessionId = await SessionService.getActiveSessionId();

        this._view.setCleanupProgress(true);
        const result = await EndShiftService.run(sessionId ?? '');
        this._view.setCleanupProgress(false);

        this._view.setCleanupResult({
            success: result.success,
            failedItems: result.failedItems,
            timestamp: new Date().toISOString(),
        });
    }

    onSuccessDismiss(navigation) {
        this._view.setCleanupResult(null);

        // Stop any in-progress recording before leaving
        if (ContinuousRecordingService.isRecording()) {
            const sid = ContinuousRecordingService.getSessionId();
            ContinuousRecordingService.toggleRecording(sid).catch(() => {});
        }
// Clear active patient — shift is over
        if (this._activePatient) {
            this._activePatient = null;
            this._view.setActivePatient(null);
        }

        // Reset the stack to ModeSelection so the nurse cannot navigate back
        // to the now-wiped Dashboard session.
        navigation.reset({
            index: 0,
            routes: [{ name: 'ModeSelection' }],
        });
    }

    onCleanupErrorDismiss() {
        this._view.setCleanupResult(null);
    }

    async onRetryCleanup(navigation) {
        this._view.setCleanupResult(null);
        await this._proceedWithCleanup(navigation);
    }
}