/**
 * USBMicStrategy
 *
 * Strategy for USB-C microphone (e.g. Rode Wireless Mini).
 * Detects whether a USB audio device is currently connected.
 */

import { Audio } from 'expo-av';

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
        try {
            const inputs = await Audio.getAvailableInputsAsync();
            return inputs.some(isUsbDevice);
        } catch {
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