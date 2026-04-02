/**
 * USBMicStrategy
 *
 * Strategy for USB-C microphone (e.g. Rode Wireless Mini).
 * Detects whether a USB audio device is currently connected.
 *
 * Note: Uses dynamic import for expo-av to avoid build errors on web
 */

import { capabilities } from '../../config/capabilities';

const USB_KEYWORDS = ['usb', 'rode', 'wireless mini', 'headset', 'external'];

function isUsbDevice(input) {
    const name = (input.name ?? '').toLowerCase();
    const type = (input.type ?? '').toLowerCase();
    return type === 'usbaudio' || USB_KEYWORDS.some((kw) => name.includes(kw));
}

const USBMicStrategy = {
    /**
     * Returns true if a USB-C mic is currently connected.
     * Always returns false on Web (no USB detection API).
     */
    async isAvailable() {
        // Web doesn't have USB audio device detection API
        if (!capabilities.isNative) {
            return false;
        }

        try {
            // Dynamic import to avoid bundling expo-av on web
            const { Audio } = await import('expo-av');
            const inputs = await Audio.getAvailableInputsAsync();
            return inputs.some(isUsbDevice);
        } catch (error) {
            console.warn('[USBMicStrategy] Failed to check USB availability:', error);
            return false;
        }
    },

    getSourceLabel() {
        return 'Rode USB-C';
    },

    getSourceKey() {
        return 'usb';
    },
};

export default USBMicStrategy;