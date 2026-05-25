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

// Once the API is confirmed missing we stop trying on every poll cycle.
let _apiAvailable = null;

const USBMicStrategy = {
    /**
     * Returns true if a USB-C mic is currently connected.
     * Always returns false on Web (no USB detection API).
     */
    async isAvailable() {
        if (!capabilities.isNative || _apiAvailable === false) {
            return false;
        }

        try {
            const { Audio } = await import('expo-av');
            const inputs = await Audio.getAvailableInputsAsync();
            _apiAvailable = true;
            return inputs.some(isUsbDevice);
        } catch (error) {
            if (error instanceof TypeError) {
                // getAvailableInputsAsync missing in this expo-av version — stop retrying.
                _apiAvailable = false;
                console.warn('[USBMicStrategy] Audio.getAvailableInputsAsync not available in this expo-av version');
            } else {
                console.warn('[USBMicStrategy] Failed to check USB availability:', error);
            }
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