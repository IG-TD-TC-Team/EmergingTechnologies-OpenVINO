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

import { AppState, Platform } from 'react-native';
import AudioSourceResolver from '../services/audio/AudioSourceResolver';
import WebRecorderService from '../services/audio/WebRecorderService';
import ServiceWorkerManager from '../services/audio/ServiceWorkerManager';
import PermissionsService from '../services/PermissionsService';
import SessionService from '../services/SessionService';
import EndShiftService from '../services/EndShiftService';
import { getStorage } from '../repositories';

export default class DashboardPresenter {
    constructor(view) {
        this._view = view;
        this._interval = null;
        this._appStateSub = null;
        this._isRecording = false;
        this._pendingNavigation = null;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async mount() {
        await this._resolveAudioSource();
        await this._checkPermission();
        await this._loadBeds();

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

        if (this._isRecording) {
            if (WebRecorderService.isSupported()) WebRecorderService.stop();
            this._isRecording = false;
            this._view.setRecording(false);
        } else {
            if (WebRecorderService.isSupported()) {
                try {
                    const sessionId = await SessionService.getActiveSessionId();
                    await WebRecorderService.start(sessionId ?? '');
                } catch (err) {
                    console.error('[DashboardPresenter] Failed to start web recording:', err);
                    return;
                }
            }
            this._isRecording = true;
            this._view.setRecording(true);
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
        if (this._isRecording) {
            this._isRecording = false;
            this._view.setRecording(false);
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