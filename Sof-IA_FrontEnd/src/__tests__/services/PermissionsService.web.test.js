/**
 * PermissionsService — Chrome Web path tests
 *
 * Covers the web-specific permission flow:
 *   _webCheck  → navigator.permissions.query (no prompt)
 *   _webRequest → navigator.mediaDevices.getUserMedia (triggers Chrome dialog)
 *   check / request / ensure / openSettings public API on web platform
 */

// ─── Mock capabilities to force the web path ──────────────────────────────────

jest.mock('../../config/capabilities', () => ({
    capabilities: { isWeb: true, isNative: false },
}));

jest.mock('react-native', () => ({
    Platform: { OS: 'web', select: jest.fn((o) => o.web ?? o.default) },
}));

// ─── Subject under test ────────────────────────────────────────────────────────

import PermissionsService from '../../services/PermissionsService';

// ─── navigator helpers ────────────────────────────────────────────────────────

function setPermissionsQuery(state) {
    global.navigator = {
        ...global.navigator,
        permissions: {
            query: jest.fn().mockResolvedValue({ state }),
        },
    };
}

function setGetUserMedia(resolve, stream = null) {
    const fakeStream = stream ?? {
        getTracks: () => [{ stop: jest.fn() }],
    };
    global.navigator = {
        ...global.navigator,
        mediaDevices: {
            getUserMedia: resolve
                ? jest.fn().mockResolvedValue(fakeStream)
                : jest.fn().mockRejectedValue(
                      Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' })
                  ),
        },
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PermissionsService — web (Chrome)', () => {

    // ── _webCheck ─────────────────────────────────────────────────────────────

    describe('_webCheck', () => {
        it('returns granted when Permissions API reports granted', async () => {
            setPermissionsQuery('granted');
            expect(await PermissionsService._webCheck()).toBe('granted');
        });

        it('returns undetermined when Permissions API reports prompt', async () => {
            setPermissionsQuery('prompt');
            expect(await PermissionsService._webCheck()).toBe('undetermined');
        });

        it('returns blocked when Permissions API reports denied', async () => {
            setPermissionsQuery('denied');
            expect(await PermissionsService._webCheck()).toBe('blocked');
        });

        it('returns undetermined when Permissions API is unavailable', async () => {
            global.navigator = { permissions: null };
            expect(await PermissionsService._webCheck()).toBe('undetermined');
        });

        it('returns undetermined when Permissions API throws', async () => {
            global.navigator = {
                permissions: { query: jest.fn().mockRejectedValue(new Error('not supported')) },
            };
            expect(await PermissionsService._webCheck()).toBe('undetermined');
        });
    });

    // ── _webRequest ──────────────────────────────────────────────────────────

    describe('_webRequest', () => {
        it('returns granted when getUserMedia resolves', async () => {
            setGetUserMedia(true);
            expect(await PermissionsService._webRequest()).toBe('granted');
        });

        it('stops all tracks on the stream after grant', async () => {
            const stopMock = jest.fn();
            const stream = { getTracks: () => [{ stop: stopMock }, { stop: stopMock }] };
            setGetUserMedia(true, stream);
            await PermissionsService._webRequest();
            expect(stopMock).toHaveBeenCalledTimes(2);
        });

        it('returns blocked when getUserMedia rejects (user denied)', async () => {
            setGetUserMedia(false);
            expect(await PermissionsService._webRequest()).toBe('blocked');
        });

        it('returns blocked when getUserMedia rejects (user dismissed)', async () => {
            global.navigator = {
                ...global.navigator,
                mediaDevices: {
                    getUserMedia: jest.fn().mockRejectedValue(
                        Object.assign(new Error('dismissed'), { name: 'NotAllowedError' })
                    ),
                },
            };
            expect(await PermissionsService._webRequest()).toBe('blocked');
        });
    });

    // ── check (public, web dispatch) ─────────────────────────────────────────

    describe('check', () => {
        it('returns granted when mic is already allowed', async () => {
            setPermissionsQuery('granted');
            expect(await PermissionsService.check()).toBe('granted');
        });

        it('returns undetermined when mic has not been asked yet', async () => {
            setPermissionsQuery('prompt');
            expect(await PermissionsService.check()).toBe('undetermined');
        });

        it('returns blocked when mic is denied in Chrome', async () => {
            setPermissionsQuery('denied');
            expect(await PermissionsService.check()).toBe('blocked');
        });
    });

    // ── request (public, web dispatch) ───────────────────────────────────────

    describe('request', () => {
        it('returns granted when nurse allows the Chrome prompt', async () => {
            setGetUserMedia(true);
            expect(await PermissionsService.request()).toBe('granted');
        });

        it('returns blocked when nurse denies the Chrome prompt', async () => {
            setGetUserMedia(false);
            expect(await PermissionsService.request()).toBe('blocked');
        });
    });

    // ── ensure ────────────────────────────────────────────────────────────────

    describe('ensure', () => {
        it('returns granted immediately without calling getUserMedia when already granted', async () => {
            setPermissionsQuery('granted');
            const gumSpy = jest.fn();
            global.navigator.mediaDevices = { getUserMedia: gumSpy };
            const result = await PermissionsService.ensure();
            expect(result).toBe('granted');
            expect(gumSpy).not.toHaveBeenCalled();
        });

        it('returns blocked immediately without calling getUserMedia when already blocked', async () => {
            setPermissionsQuery('denied');
            const gumSpy = jest.fn();
            global.navigator.mediaDevices = { getUserMedia: gumSpy };
            const result = await PermissionsService.ensure();
            expect(result).toBe('blocked');
            expect(gumSpy).not.toHaveBeenCalled();
        });

        it('triggers getUserMedia when status is undetermined', async () => {
            setPermissionsQuery('prompt');
            setGetUserMedia(true);
            const result = await PermissionsService.ensure();
            expect(result).toBe('granted');
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
        });
    });

    // ── openSettings ─────────────────────────────────────────────────────────

    describe('openSettings', () => {
        it('is a no-op on web and resolves without throwing', async () => {
            await expect(PermissionsService.openSettings()).resolves.toBeUndefined();
        });
    });
});
