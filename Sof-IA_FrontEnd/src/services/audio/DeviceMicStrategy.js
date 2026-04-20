/**
 * DeviceMicStrategy
 *
 * Fallback strategy — uses the device built-in microphone.
 * On web, resolves the real mic name from the browser's media device list.
 */

const DeviceMicStrategy = {
    _label: null,

    async isAvailable() {
        return true;
    },

    // Queries enumerateDevices() and caches the default mic label.
    // No-ops on native or if already resolved.
    async refreshLabel() {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputs = devices.filter((d) => d.kind === 'audioinput');
            if (inputs.length === 0) return;

            // Prefer the default device; browsers mark it with deviceId 'default' or list it first
            const defaultDevice = inputs.find((d) => d.deviceId === 'default') ?? inputs[0];
            const label = defaultDevice.label?.trim();

            // Labels are empty strings until the user grants mic permission —
            // only update the cache once a real name is available
            if (label) {
                // Strip trailing "(Built-in)" / "(Default)" suffixes common on Windows
                this._label = label.replace(/\s*\(?(default|built.?in)\)?$/i, '').trim() || label;
            }
        } catch (_) {}
    },

    getSourceLabel() {
        return this._label ?? 'Built-in mic';
    },

    getSourceKey() {
        return 'builtin';
    },
};

export default DeviceMicStrategy;
