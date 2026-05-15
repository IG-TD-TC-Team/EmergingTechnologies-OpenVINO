/**
 * NetworkMonitor — singleton connectivity tracker + useNetworkStatus() hook.
 *
 * Responsibilities:
 *   1. Subscribe to connectivity changes via @react-native-community/netinfo
 *      (works on both Android and Web; falls back to window online/offline events
 *      if the package is not yet installed, matching the pattern already used in
 *      OfflineQueueService.js).
 *   2. On offline → online transition: call OfflineQueueManager.retryPending()
 *      and emit 'network:reconnected' so the UI can show the "Back online" toast.
 *   3. On online → offline: emit 'network:offline' so the UI can show the
 *      buffering badge.
 *   4. Expose useNetworkStatus() hook — returns { isOnline: boolean } — for any
 *      component that needs to react to connectivity changes.
 *
 * Lifecycle:
 *   Call NetworkMonitor.start() once during app initialisation (e.g., in
 *   ContinuousRecordingService.initialize() or App.js).
 *   Call NetworkMonitor.stop() on teardown (optional; service-worker path never stops).
 *
 * Event bus follows the same on(event, handler) → unsubscribe() pattern used by
 * ContinuousRecordingService and OfflineQueueManager.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import OfflineQueueManager from '../queue/OfflineQueueManager';

// ─── Event types ──────────────────────────────────────────────────────────────

export type NetworkEvent = 'network:reconnected' | 'network:offline';

type Unsubscribe = () => void;

// ─── Monitor ──────────────────────────────────────────────────────────────────

class NetworkMonitorClass {
  /**
   * Current connectivity state.
   * Defaults to true (optimistic) until the first NetInfo reading arrives.
   */
  private _isOnline: boolean = true;

  /**
   * Previous connectivity state.
   * null = unknown (start() not yet called or no reading received yet).
   * Kept separate from _isOnline so we can detect the offline→online edge
   * without triggering a spurious retryPending() on cold start.
   */
  private _prevOnline: boolean | null = null;

  /** Cleanup function returned by NetInfo.addEventListener or window.removeEventListener. */
  private _unsubscribe: Unsubscribe | null = null;

  private _listeners: {
    'network:reconnected': Array<() => void>;
    'network:offline': Array<() => void>;
  } = {
    'network:reconnected': [],
    'network:offline': [],
  };

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Start monitoring connectivity.
   * Safe to call multiple times — subsequent calls are no-ops.
   *
   * Reads the initial network state before subscribing so that:
   *  - _prevOnline is seeded with the real current state
   *  - A reconnect event is NOT fired just because the app launched while online
   */
  async start(): Promise<void> {
    if (this._unsubscribe) return;

    if (Platform.OS === 'web') {
      this._startWebListener();
    } else {
      await this._startNetInfoListener();
    }
  }

  /** Stop monitoring and clean up the subscription. */
  stop(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  // ─── Event bus ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to a network event.
   * Returns an unsubscribe function — same pattern as ContinuousRecordingService.
   *
   * @example
   * const unsub = NetworkMonitor.on('network:reconnected', () => {
   *   showToast('Back online. Syncing captured audio…');
   * });
   */
  on(event: NetworkEvent, handler: () => void): Unsubscribe {
    this._listeners[event].push(handler);
    return () => {
      this._listeners[event] = this._listeners[event].filter((h) => h !== handler);
    };
  }

  private _emit(event: NetworkEvent): void {
    this._listeners[event].forEach((h) => h());
  }

  // ─── Public state ──────────────────────────────────────────────────────────

  /** Synchronous read of the last known connectivity state. */
  isOnline(): boolean {
    return this._isOnline;
  }

  // ─── State change handler ──────────────────────────────────────────────────

  /**
   * Central handler called on every connectivity change.
   * Detects the offline → online edge to avoid unnecessary retries.
   */
  private _handleChange(isConnected: boolean): void {
    const prev = this._prevOnline;
    this._isOnline = isConnected;
    this._prevOnline = isConnected;

    if (!isConnected) {
      this._emit('network:offline');
      return;
    }

    // Only fire on offline → online transition.
    // prev === null means this is the initial reading on startup — don't retry.
    if (prev === false) {
      this._emit('network:reconnected');
      OfflineQueueManager.retryPending().catch((err) =>
        console.error('[NetworkMonitor] retryPending error:', err)
      );
    }
  }

  // ─── Platform backends ─────────────────────────────────────────────────────

  /**
   * Android (and iOS) path: use @react-native-community/netinfo.
   * Falls back to the web listener if the package is unavailable (e.g., in Jest
   * without native modules mocked).
   */
  private async _startNetInfoListener(): Promise<void> {
    try {
      const NetInfo = require('@react-native-community/netinfo').default;

      // Seed initial state — do NOT trigger _handleChange so we don't fire
      // a spurious reconnect on cold start.
      const initial = await NetInfo.fetch();
      this._isOnline = initial.isConnected ?? true;
      this._prevOnline = this._isOnline;

      this._unsubscribe = NetInfo.addEventListener(
        (state: { isConnected: boolean | null }) => {
          this._handleChange(state.isConnected ?? true);
        }
      );

      console.log(
        '[NetworkMonitor] NetInfo listener active. Initial state:',
        this._isOnline ? 'online' : 'offline'
      );
    } catch (_) {
      console.warn(
        '[NetworkMonitor] @react-native-community/netinfo not available'
      );
      if (Platform.OS === 'web') {
        this._startWebListener();
      } else {
        // Native without NetInfo — optimistic default, no event-driven updates.
        this._isOnline = true;
        this._prevOnline = true;
        this._unsubscribe = () => {};
      }
    }
  }

  /**
   * Web (and fallback) path: use the browser's online/offline events.
   * navigator.onLine is used to seed the initial state synchronously.
   */
  private _startWebListener(): void {
    const onOnline = () => this._handleChange(true);
    const onOffline = () => this._handleChange(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Seed initial state synchronously — no reconnect event.
    this._isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this._prevOnline = this._isOnline;

    this._unsubscribe = () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };

    console.log(
      '[NetworkMonitor] Web listener active. Initial state:',
      this._isOnline ? 'online' : 'offline'
    );
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

const NetworkMonitor = new NetworkMonitorClass();
export default NetworkMonitor;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useNetworkStatus — React hook for connectivity state.
 *
 * Returns { isOnline: boolean } which updates whenever the network transitions.
 * Does not require a Context Provider — subscribes directly to the NetworkMonitor
 * singleton, consistent with how components subscribe to ContinuousRecordingService.
 *
 * NetworkMonitor.start() must have been called before this hook mounts for the
 * initial value to reflect real connectivity. If start() hasn't been called,
 * isOnline defaults to true (optimistic).
 *
 * @example
 * function SyncBadge() {
 *   const { isOnline } = useNetworkStatus();
 *   return <View style={{ backgroundColor: isOnline ? 'green' : 'orange' }} />;
 * }
 */
export function useNetworkStatus(): { isOnline: boolean } {
  // Initialise from the singleton's current state so there's no flicker on mount.
  const [isOnline, setIsOnline] = useState<boolean>(() => NetworkMonitor.isOnline());

  useEffect(() => {
    // Re-sync in case the state changed between the useState initialiser and
    // the effect running (rare, but possible on slow mounts).
    setIsOnline(NetworkMonitor.isOnline());

    const unsubReconnected = NetworkMonitor.on('network:reconnected', () =>
      setIsOnline(true)
    );
    const unsubOffline = NetworkMonitor.on('network:offline', () =>
      setIsOnline(false)
    );

    return () => {
      unsubReconnected();
      unsubOffline();
    };
  }, []);

  return { isOnline };
}
