/**
 * ServiceWorkerManager
 *
 * Registers the Sof-IA service worker and schedules background uploads of
 * pending audio chunks via the Background Sync API.
 *
 * The SW fires the 'upload-audio-chunks' sync event even when the tab is
 * hidden or the browser is minimised, so chunks are uploaded without any
 * user interaction.
 *
 * ─── Message protocol (SW → page) ───────────────────────────────────────────
 * { type: 'QUEUE_RETRY' }  — received when the SW detects a failed or recovering
 *   transcription API call. Triggers OfflineQueueManager.retryPending() here.
 *
 * ─── visibilitychange fallback ───────────────────────────────────────────────
 * When the tab regains focus (nurse switches back to the app), we drain the
 * queue immediately. This covers browsers without Background Sync or cases
 * where the SW message was missed while the tab was hidden.
 *
 * Graceful degradation:
 *   - No serviceWorker support  → register() returns false, requestSync() is a no-op
 *   - No BackgroundSync support → requestSync() is a no-op (ChunkUploadService
 *                                  handles foreground uploads on flushSession)
 *
 * Public API:
 *   register()    → Promise<boolean>  — call once on app start (web only)
 *   requestSync() → Promise<void>     — call after each chunk is persisted to IDB
 *   isSupported() → boolean           — true when the serviceWorker API is present
 */

import OfflineQueueManager from '../queue/OfflineQueueManager';

const SYNC_TAG = 'upload-audio-chunks';
const SW_PATH  = '/sw.js';

const ServiceWorkerManager = {
    /** Cached ServiceWorkerRegistration returned by the last successful register(). */
    _registration: null,
    /** True once the page-side listeners (message + visibilitychange) are wired up. */
    _listenersAdded: false,

    /**
     * Register the service worker at /sw.js with root scope, then wire up the
     * page-side listeners for QUEUE_RETRY messages and visibilitychange.
     * Idempotent — safe to call multiple times.
     *
     * @returns {Promise<boolean>} true on success, false if unsupported or registration fails.
     */
    async register() {
        if (!this.isSupported()) return false;
        if (this._registration) return true;

        try {
            this._registration = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
            this._setupPageListeners();
            return true;
        } catch (err) {
            console.error('[ServiceWorkerManager] Registration failed:', err);
            return false;
        }
    },

    /**
     * Wire up:
     *  1. navigator.serviceWorker message listener — handles QUEUE_RETRY posted by the SW.
     *  2. document visibilitychange listener — drains queue when the nurse tabs back in.
     *
     * Called once from register(). Guards against double-registration with _listenersAdded.
     */
    _setupPageListeners() {
        if (this._listenersAdded) return;
        this._listenersAdded = true;

        // ── SW → page message handler ─────────────────────────────────────────
        // The SW posts { type: 'QUEUE_RETRY' } when it detects a failing or
        // recovering transcription API call (fetch event interception) or after
        // a background sync completes. We delegate to OfflineQueueManager which
        // owns the backoff logic and the _draining guard.
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event?.data?.type === 'QUEUE_RETRY') {
                console.log('[ServiceWorkerManager] QUEUE_RETRY received from SW');
                OfflineQueueManager.retryPending().catch((err) =>
                    console.error('[ServiceWorkerManager] retryPending error:', err)
                );
            }
        });

        // ── visibilitychange fallback ─────────────────────────────────────────
        // Triggered when the nurse switches back to the tab (or unlocks the device
        // with the tab open). Covers browsers that don't support Background Sync
        // or cases where the SW message was lost while the tab was hidden.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('[ServiceWorkerManager] Tab visible — draining queue');
                OfflineQueueManager.retryPending().catch((err) =>
                    console.error('[ServiceWorkerManager] retryPending (visibility) error:', err)
                );
            }
        });

        console.log('[ServiceWorkerManager] Page listeners active (message + visibilitychange)');
    },

    /**
     * Schedule a background sync upload.
     * Uses the Background Sync API when available; silently no-ops otherwise.
     *
     * The browser will fire the 'upload-audio-chunks' sync event in sw.js
     * even when the tab is hidden, allowing chunks to reach the API in the
     * background.
     *
     * @returns {Promise<void>}
     */
    async requestSync() {
        if (!this.isSupported()) return;

        try {
            const reg = this._registration ?? (await navigator.serviceWorker.ready);
            if (reg && 'sync' in reg) {
                await reg.sync.register(SYNC_TAG);
            }
        } catch (err) {
            // Background Sync not supported or denied — foreground upload path takes over.
            console.warn('[ServiceWorkerManager] Background sync unavailable:', err);
        }
    },

    /**
     * True when the ServiceWorker API is available in this environment.
     * Always false on Android (no navigator.serviceWorker).
     *
     * @returns {boolean}
     */
    isSupported() {
        return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
    },
};

export default ServiceWorkerManager;
