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
 */

import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as Linking from 'expo-linking';

function mapExpoStatus(status, canAskAgain) {
    if (status === 'granted') return 'granted';
    if (status === 'undetermined') return 'undetermined';
    return canAskAgain ? 'denied' : 'blocked';
}

const PermissionsService = {
    /** Check current status WITHOUT prompting. Call on launch and foreground. */
    async check() {
        if (Platform.OS === 'web') return 'granted';
        const { status, canAskAgain } = await Audio.getPermissionsAsync();
        return mapExpoStatus(status, canAskAgain);
    },

    /** Show the native Android permission dialog. */
    async request() {
        if (Platform.OS === 'web') return 'granted';
        const { status, canAskAgain } = await Audio.requestPermissionsAsync();
        return mapExpoStatus(status, canAskAgain);
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
        await Linking.openSettings();
    },
};

export default PermissionsService;