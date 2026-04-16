/**
 * PermissionsService
 *
 * Handles microphone permission logic for Android and Chrome Web.
 *
 * Permission states:
 *   'undetermined' — never asked
 *   'granted'      — approved
 *   'denied'       — refused, can ask again (Android only)
 *   'blocked'      — permanently denied, must open OS/browser settings
 *
 * Chrome Web: uses navigator.permissions + navigator.mediaDevices.getUserMedia.
 * Android: uses expo-av Audio permissions (dynamic import to avoid web bundle).
 */

import { capabilities } from '../config/capabilities';

function mapExpoStatus(status, canAskAgain) {
    if (status === 'granted') return 'granted';
    if (status === 'undetermined') return 'undetermined';
    return canAskAgain ? 'denied' : 'blocked';
}

const PermissionsService = {
    /**
     * Check current mic permission status WITHOUT prompting.
     * Call on mount and whenever the app returns to foreground.
     */
    async check() {
        if (capabilities.isWeb) return this._webCheck();

        try {
            const { Audio } = await import('expo-av');
            const { status, canAskAgain } = await Audio.getPermissionsAsync();
            return mapExpoStatus(status, canAskAgain);
        } catch (error) {
            console.error('[PermissionsService] Failed to check permissions:', error);
            return 'undetermined';
        }
    },

    /**
     * Trigger the permission dialog.
     * Chrome: shows the browser mic prompt via getUserMedia.
     * Android: shows the OS permission dialog via expo-av.
     */
    async request() {
        if (capabilities.isWeb) return this._webRequest();

        try {
            const { Audio } = await import('expo-av');
            const { status, canAskAgain } = await Audio.requestPermissionsAsync();
            return mapExpoStatus(status, canAskAgain);
        } catch (error) {
            console.error('[PermissionsService] Failed to request permissions:', error);
            return 'denied';
        }
    },

    /**
     * Main entry point — call before starting any recording.
     *   granted      → returns immediately, no dialog shown
     *   blocked      → returns 'blocked', no dialog (caller shows settings banner)
     *   undetermined → shows platform permission dialog, returns result
     */
    async ensure() {
        const current = await this.check();
        if (current === 'granted') return 'granted';
        if (current === 'blocked') return 'blocked';
        return this.request();
    },

    /**
     * Open OS/browser settings so the nurse can un-block the mic.
     * Android: deep-links to app settings via expo-linking.
     * Chrome: no-op — browser settings cannot be opened programmatically;
     *         MicPermissionBanner shows inline instructions instead.
     */
    async openSettings() {
        if (capabilities.isWeb) return;

        try {
            const Linking = await import('expo-linking');
            await Linking.openSettings();
        } catch (error) {
            console.error('[PermissionsService] Failed to open settings:', error);
            throw new Error('Failed to open system settings');
        }
    },

    // ─── Web (Chrome) helpers ──────────────────────────────────────────────────

    /**
     * Read current mic permission state via the Permissions API — no prompt.
     * Maps Chrome states to the app's internal state vocabulary:
     *   'granted' → 'granted'
     *   'prompt'  → 'undetermined'
     *   'denied'  → 'blocked'  (Chrome denials are persistent per-origin)
     */
    async _webCheck() {
        try {
            if (navigator?.permissions?.query) {
                const result = await navigator.permissions.query({ name: 'microphone' });
                if (result.state === 'granted') return 'granted';
                if (result.state === 'denied') return 'blocked';
                return 'undetermined'; // state === 'prompt'
            }
        } catch {
            // Permissions API unavailable — conservative fallback
        }
        return 'undetermined';
    },

    /**
     * Trigger the Chrome mic permission dialog via getUserMedia.
     * Stops the stream immediately after grant — we only need the permission.
     * Any refusal (denied or dismissed) is mapped to 'blocked' because Chrome
     * persists the denial for the origin until the nurse changes it in Site Settings.
     */
    async _webRequest() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((track) => track.stop());
            return 'granted';
        } catch {
            return 'blocked';
        }
    },
};

export default PermissionsService;