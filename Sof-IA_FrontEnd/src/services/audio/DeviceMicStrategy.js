/**
 * DeviceMicStrategy
 *
 * Fallback strategy — uses the device built-in microphone.
 * Always available.
 */

const DeviceMicStrategy = {
    async isAvailable() {
        return true;
    },

    getSourceLabel() {
        return 'Built-in mic';
    },

    getSourceKey() {
        return 'builtin';
    },
};

export default DeviceMicStrategy;