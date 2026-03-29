/**
 * AudioSourceResolver
 * Auto-detects the active audio source, and allows manual override.
 *
 * Behaviour:
 *   - On mount: auto-selects USB-C if connected, otherwise built-in
 *   - Manual override: nurse can tap the badge to switch source
 *   - If USB is unplugged while manually set to USB → auto-falls back to built-in
 *   - On Web: always built-in (no USB detection API)
 */

import { Platform } from 'react-native';
import USBMicStrategy from './USBMicStrategy';
import DeviceMicStrategy from './DeviceMicStrategy';

const AudioSourceResolver = {
    // null = auto mode, 'usb' | 'builtin' = manual override
    _manualOverride: null,

    /**
     * Resolves the active strategy.
     * Respects manual override if the selected source is still available.
     */
    async resolve() {
        if (Platform.OS === 'web') return DeviceMicStrategy;

        const usbAvailable = await USBMicStrategy.isAvailable();

        // Manual override — only honour it if the source is still available
        if (this._manualOverride === 'usb') {
            return usbAvailable ? USBMicStrategy : DeviceMicStrategy;
        }
        if (this._manualOverride === 'builtin') {
            return DeviceMicStrategy;
        }

        // Auto mode
        return usbAvailable ? USBMicStrategy : DeviceMicStrategy;
    },

    /**
     * Toggles between USB-C and built-in mic.
     * Called when nurse taps the audio source badge.
     * Returns the new strategy immediately (before next poll).
     */
    async toggle() {
        const usbAvailable = await USBMicStrategy.isAvailable();
        const current = this._manualOverride;

        if (current === 'builtin' || (!current && usbAvailable)) {
            // Currently on built-in (or auto=USB) → switch to built-in or USB
            this._manualOverride = current === 'builtin' && usbAvailable ? 'usb' : 'builtin';
        } else {
            this._manualOverride = 'builtin';
        }

        return this.resolve();
    },

    /** Returns available sources so the UI can show what's selectable. */
    async getAvailableSources() {
        if (Platform.OS === 'web') return [DeviceMicStrategy];
        const usbAvailable = await USBMicStrategy.isAvailable();
        return usbAvailable
            ? [USBMicStrategy, DeviceMicStrategy]
            : [DeviceMicStrategy];
    },

    /** Resets to auto mode (called on unmount or USB unplug). */
    resetOverride() {
        this._manualOverride = null;
    },
};

export default AudioSourceResolver;