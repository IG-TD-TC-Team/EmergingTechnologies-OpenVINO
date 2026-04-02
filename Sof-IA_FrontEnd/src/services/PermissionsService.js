/**
 * PermissionsService
 *
 * Handles all microphone permission logic for Android.
 * Chrome Web: always returns 'granted' (covered by getUserMedia in US16).
 *
 * Permission states:
 *   'undetermined' — never asked
 *   'granted'      — approved
 *   'denied'       — refused, can ask again
 *   'blocked'      — permanently denied, must open OS Settings
 *
 * Requires: npx expo install expo-av expo-linking
 * Note: Uses dynamic imports to avoid build errors on web
 */

import { capabilities } from '../config/capabilities';

function mapExpoStatus(status, canAskAgain) {
    if (status === 'granted') return 'granted';
    if (status === 'undetermined') return 'undetermined';
    return canAskAgain ? 'denied' : 'blocked';
}

const PermissionsService = {
    /** Check current status WITHOUT prompting. Call on launch and foreground. */
    async check() {
        if (capabilities.isWeb) return 'granted';

        try {
            // Dynamic import to avoid bundling expo-av on web
            const { Audio } = await import('expo-av');
            const { status, canAskAgain } = await Audio.getPermissionsAsync();
            return mapExpoStatus(status, canAskAgain);
        } catch (error) {
            console.error('[PermissionsService] Failed to check permissions:', error);
            return 'undetermined';
        }
    },

    /** Show the native Android permission dialog. */
    async request() {
        if (capabilities.isWeb) return 'granted';

        try {
            // Dynamic import to avoid bundling expo-av on web
            const { Audio } = await import('expo-av');
            const { status, canAskAgain } = await Audio.requestPermissionsAsync();
            return mapExpoStatus(status, canAskAgain);
        } catch (error) {
            console.error('[PermissionsService] Failed to request permissions:', error);
            return 'denied';
        }
    },

    /**
     * Main entry — call before starting any recording.
     *   granted      → returns immediately, no dialog
     *   blocked      → returns 'blocked', no dialog (caller shows Settings banner)
     *   undetermined / denied → shows OS dialog, returns result
     */
    async ensure() {
        const current = await this.check();
        if (current === 'granted') return 'granted';
        if (current === 'blocked') return 'blocked';
        return this.request();
    },

    /** Deep-link to Android app settings (for permanently blocked state). */
    async openSettings() {
        // Web doesn't have system settings to open
        if (capabilities.isWeb) {
            console.warn('[PermissionsService] openSettings() not available on web platform');
            return;
        }

        try {
            // Dynamic import to avoid bundling expo-linking on web
            const Linking = await import('expo-linking');
            await Linking.openSettings();
        } catch (error) {
            console.error('[PermissionsService] Failed to open settings:', error);
            throw new Error('Failed to open system settings');
        }
    },
};

export default PermissionsService;