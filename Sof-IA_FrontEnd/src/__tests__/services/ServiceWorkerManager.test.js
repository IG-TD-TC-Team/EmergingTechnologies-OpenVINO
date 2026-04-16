/**
 * ServiceWorkerManager Tests
 *
 * Covers:
 *   isSupported  — true with SW API, false without
 *   register     — success, idempotent, unsupported, registration failure
 *   requestSync  — schedules sync tag, no-op paths, falls back to .ready
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

let ServiceWorkerManager;

/** Re-import the module fresh so _registration is reset between tests. */
function freshModule() {
    jest.resetModules();
    ServiceWorkerManager = require('../../services/audio/ServiceWorkerManager').default;
}

function makeSyncRegister() {
    return jest.fn().mockResolvedValue(undefined);
}

function makeRegistration(syncRegister = makeSyncRegister()) {
    return { sync: { register: syncRegister } };
}

/** Install a full navigator.serviceWorker mock. */
function mockSW(overrides = {}) {
    const syncRegister = overrides.syncRegister ?? makeSyncRegister();
    const registration = overrides.registration ?? makeRegistration(syncRegister);

    Object.defineProperty(global, 'navigator', {
        value: {
            serviceWorker: {
                register: jest.fn().mockResolvedValue(registration),
                ready: Promise.resolve(registration),
                ...overrides.serviceWorker,
            },
        },
        writable: true,
        configurable: true,
    });

    return { registration, syncRegister };
}

/** Remove serviceWorker from navigator. */
function removeSW() {
    Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
    });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    freshModule();
});

afterEach(() => {
    removeSW();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ServiceWorkerManager', () => {

    // ── isSupported ────────────────────────────────────────────────────────────

    describe('isSupported', () => {
        it('returns true when navigator.serviceWorker is present', () => {
            mockSW();
            expect(ServiceWorkerManager.isSupported()).toBe(true);
        });

        it('returns false when navigator has no serviceWorker', () => {
            removeSW();
            expect(ServiceWorkerManager.isSupported()).toBe(false);
        });
    });

    // ── register ───────────────────────────────────────────────────────────────

    describe('register', () => {
        it('registers at /sw.js with root scope and returns true', async () => {
            mockSW();
            const result = await ServiceWorkerManager.register();

            expect(result).toBe(true);
            expect(navigator.serviceWorker.register).toHaveBeenCalledWith(
                '/sw.js',
                { scope: '/' }
            );
        });

        it('caches the registration — does not re-register on second call', async () => {
            mockSW();
            await ServiceWorkerManager.register();
            await ServiceWorkerManager.register();

            expect(navigator.serviceWorker.register).toHaveBeenCalledTimes(1);
        });

        it('returns true on second call (already registered)', async () => {
            mockSW();
            await ServiceWorkerManager.register();
            const result = await ServiceWorkerManager.register();

            expect(result).toBe(true);
        });

        it('returns false when serviceWorker API is absent', async () => {
            removeSW();
            const result = await ServiceWorkerManager.register();
            expect(result).toBe(false);
        });

        it('returns false and does not throw when registration rejects', async () => {
            Object.defineProperty(global, 'navigator', {
                value: {
                    serviceWorker: {
                        register: jest.fn().mockRejectedValue(new Error('SecurityError')),
                        ready: Promise.resolve(makeRegistration()),
                    },
                },
                writable: true,
                configurable: true,
            });

            const result = await ServiceWorkerManager.register();
            expect(result).toBe(false);
        });
    });

    // ── requestSync ────────────────────────────────────────────────────────────

    describe('requestSync', () => {
        it('registers the upload-audio-chunks sync tag', async () => {
            const { syncRegister } = mockSW();
            await ServiceWorkerManager.register();
            await ServiceWorkerManager.requestSync();

            expect(syncRegister).toHaveBeenCalledWith('upload-audio-chunks');
        });

        it('is a no-op when serviceWorker API is absent', async () => {
            removeSW();
            await expect(ServiceWorkerManager.requestSync()).resolves.toBeUndefined();
        });

        it('is a no-op when the registration has no sync property', async () => {
            const registrationWithoutSync = {}; // no .sync
            Object.defineProperty(global, 'navigator', {
                value: {
                    serviceWorker: {
                        register: jest.fn().mockResolvedValue(registrationWithoutSync),
                        ready: Promise.resolve(registrationWithoutSync),
                    },
                },
                writable: true,
                configurable: true,
            });

            await ServiceWorkerManager.register();
            await expect(ServiceWorkerManager.requestSync()).resolves.toBeUndefined();
        });

        it('falls back to navigator.serviceWorker.ready when not yet registered', async () => {
            const { syncRegister } = mockSW();
            // Do NOT call register() first — should still schedule via .ready
            await ServiceWorkerManager.requestSync();

            expect(syncRegister).toHaveBeenCalledWith('upload-audio-chunks');
        });

        it('uses the cached registration when already registered', async () => {
            const { syncRegister } = mockSW();
            await ServiceWorkerManager.register();
            await ServiceWorkerManager.requestSync();
            await ServiceWorkerManager.requestSync();

            // .ready should not have been awaited a second time
            expect(syncRegister).toHaveBeenCalledTimes(2);
        });

        it('does not throw when sync.register rejects', async () => {
            const failingSync = { register: jest.fn().mockRejectedValue(new Error('denied')) };
            const reg = { sync: failingSync };

            Object.defineProperty(global, 'navigator', {
                value: {
                    serviceWorker: {
                        register: jest.fn().mockResolvedValue(reg),
                        ready: Promise.resolve(reg),
                    },
                },
                writable: true,
                configurable: true,
            });

            await ServiceWorkerManager.register();
            await expect(ServiceWorkerManager.requestSync()).resolves.toBeUndefined();
        });
    });
});
