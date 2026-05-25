/**
 * NetworkMonitor — unit tests
 *
 * Verifies the core contract: retryPending() is called exactly on the
 * offline→online edge, not on cold start or on a repeated online reading.
 *
 * Platform.OS='web' (set globally in jest.setup.js), so the monitor's
 * web listener path (_startWebListener) is exercised here.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../services/queue/OfflineQueueManager', () => ({
  __esModule: true,
  default: {
    retryPending: jest.fn().mockResolvedValue(0),
    configure:    jest.fn(),
    on:           jest.fn(() => jest.fn()),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import NetworkMonitor from '../../services/network/NetworkMonitor';
import OfflineQueueManager from '../../services/queue/OfflineQueueManager';

// ─── Window / navigator setup ─────────────────────────────────────────────────

/** Captured handlers from window.addEventListener. */
let onlineHandler:  (() => void) | undefined;
let offlineHandler: (() => void) | undefined;

function installWindowMock(initiallyOnline = true) {
  onlineHandler  = undefined;
  offlineHandler = undefined;

  (global as any).window = {
    addEventListener: jest.fn((event: string, handler: () => void) => {
      if (event === 'online')  onlineHandler  = handler;
      if (event === 'offline') offlineHandler = handler;
    }),
    removeEventListener: jest.fn(),
  };
  (global as any).navigator = { onLine: initiallyOnline };
}

function simulateOnline()  { onlineHandler?.(); }
function simulateOffline() { offlineHandler?.(); }

// ─── Monitor reset ────────────────────────────────────────────────────────────

function resetMonitor() {
  const m = NetworkMonitor as any;
  m._isOnline    = true;
  m._prevOnline  = null;
  m._unsubscribe = null;
  m._listeners   = { 'network:reconnected': [], 'network:offline': [] };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NetworkMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMonitor();
    installWindowMock(true);
  });

  afterAll(() => {
    delete (global as any).window;
    delete (global as any).navigator;
  });

  // ── cold start ────────────────────────────────────────────────────────────

  describe('cold start', () => {
    it('does NOT call retryPending when starting while already online', async () => {
      installWindowMock(true);
      await NetworkMonitor.start();

      // No connectivity change — just started
      expect(OfflineQueueManager.retryPending).not.toHaveBeenCalled();
    });

    it('does NOT call retryPending when starting while offline', async () => {
      installWindowMock(false);
      resetMonitor();
      await NetworkMonitor.start();

      expect(OfflineQueueManager.retryPending).not.toHaveBeenCalled();
    });

    it('seeds isOnline() from navigator.onLine', async () => {
      installWindowMock(false);
      resetMonitor();
      await NetworkMonitor.start();

      expect(NetworkMonitor.isOnline()).toBe(false);
    });
  });

  // ── offline → online (the reconnect edge) ────────────────────────────────

  describe('offline → online transition', () => {
    it('calls retryPending() when the device comes back online', async () => {
      installWindowMock(false);
      resetMonitor();
      await NetworkMonitor.start();

      simulateOffline();
      simulateOnline();

      expect(OfflineQueueManager.retryPending).toHaveBeenCalledTimes(1);
    });

    it('emits network:reconnected on offline → online', async () => {
      installWindowMock(false);
      resetMonitor();
      await NetworkMonitor.start();

      const handler = jest.fn();
      NetworkMonitor.on('network:reconnected', handler);

      simulateOffline();
      simulateOnline();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('updates isOnline() to true after reconnect', async () => {
      installWindowMock(false);
      resetMonitor();
      await NetworkMonitor.start();

      simulateOffline();
      expect(NetworkMonitor.isOnline()).toBe(false);

      simulateOnline();
      expect(NetworkMonitor.isOnline()).toBe(true);
    });
  });

  // ── online → offline ──────────────────────────────────────────────────────

  describe('online → offline transition', () => {
    it('emits network:offline when the device goes offline', async () => {
      await NetworkMonitor.start();

      const handler = jest.fn();
      NetworkMonitor.on('network:offline', handler);

      simulateOffline();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does NOT call retryPending when going offline', async () => {
      await NetworkMonitor.start();

      simulateOffline();

      expect(OfflineQueueManager.retryPending).not.toHaveBeenCalled();
    });

    it('updates isOnline() to false after going offline', async () => {
      await NetworkMonitor.start();

      simulateOffline();

      expect(NetworkMonitor.isOnline()).toBe(false);
    });
  });

  // ── repeated online readings ──────────────────────────────────────────────

  describe('no spurious retryPending on online → online', () => {
    it('does NOT call retryPending if already online when online event fires', async () => {
      await NetworkMonitor.start(); // starts online (_prevOnline = true)

      // Simulate a second 'online' event without any prior 'offline' event
      simulateOnline();

      // Transition was online→online (prev===true, not false) — no retry
      expect(OfflineQueueManager.retryPending).not.toHaveBeenCalled();
    });

    it('calls retryPending only once for a single reconnect cycle', async () => {
      installWindowMock(false);
      resetMonitor();
      await NetworkMonitor.start();

      simulateOffline();
      simulateOnline();
      simulateOnline(); // second online with no intervening offline

      expect(OfflineQueueManager.retryPending).toHaveBeenCalledTimes(1);
    });
  });

  // ── event bus ─────────────────────────────────────────────────────────────

  describe('event bus', () => {
    it('on() returns an unsubscribe function — handler fires before unsub, not after', async () => {
      await NetworkMonitor.start();

      const handler = jest.fn();
      const unsub = NetworkMonitor.on('network:offline', handler);

      // Handler called once while subscribed
      simulateOffline();
      expect(handler).toHaveBeenCalledTimes(1);

      // Unsubscribe — further events must not reach the handler
      unsub();
      simulateOnline();
      simulateOffline();
      expect(handler).toHaveBeenCalledTimes(1); // still 1, not 2
    });

    it('unsubscribes correctly — handler not called after unsub()', async () => {
      await NetworkMonitor.start();

      const handler = jest.fn();
      const unsub = NetworkMonitor.on('network:offline', handler);
      unsub();

      simulateOffline();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── start() idempotency ───────────────────────────────────────────────────

  describe('start() idempotency', () => {
    it('registers window listeners only once on repeated start() calls', async () => {
      const win = (global as any).window;
      await NetworkMonitor.start();
      await NetworkMonitor.start();

      // addEventListener should have been called exactly twice (online + offline)
      // not four times
      const calls = (win.addEventListener as jest.Mock).mock.calls;
      expect(calls.filter(([e]: [string]) => e === 'online').length).toBe(1);
      expect(calls.filter(([e]: [string]) => e === 'offline').length).toBe(1);
    });
  });
});
