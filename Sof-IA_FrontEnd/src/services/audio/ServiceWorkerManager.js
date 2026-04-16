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

const SYNC_TAG = 'upload-audio-chunks';
const SW_PATH  = '/sw.js';

const ServiceWorkerManager = {
    /** Cached ServiceWorkerRegistration returned by the last successful register(). */
    _registration: null,

    /**
     * Register the service worker at /sw.js with root scope.
     * Idempotent — returns immediately if already registered.
     *
     * @returns {Promise<boolean>} true on success, false if unsupported or registration fails.
     */
    async register() {
        if (!this.isSupported()) return false;
        if (this._registration) return true;

        try {
            this._registration = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
            return true;
        } catch (err) {
            console.error('[ServiceWorkerManager] Registration failed:', err);
            return false;
        }
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
