/**
 * SyncStatusIndicator
 *
 * Non-blocking dashboard pill that shows the offline queue state.
 * Returns null when the queue is idle (no UI clutter during normal operation).
 *
 * States:
 *   idle    — hidden (null)
 *   offline — orange dot + "Buffering: N chunks"
 *   syncing — spinning ActivityIndicator + "Syncing…"
 *   failed  — red dot + "N chunks failed"
 *
 * Every visible state is tappable and triggers OfflineQueueManager.retryPending().
 * For 'syncing' this is a no-op (the manager's _draining guard prevents overlapping
 * drain loops), but the press feedback reassures the nurse that the app is active.
 *
 * ─── State derivation ────────────────────────────────────────────────────────
 *   failed  wins over everything (most urgent — needs nurse attention)
 *   offline = no network + pending chunks queued
 *   syncing = online + chunks are being (or about to be) uploaded
 *   idle    = no pending, no failed
 *
 * ─── Event wiring ────────────────────────────────────────────────────────────
 *   OfflineQueueManager:
 *     queue:synced         → clear isSyncing flag, refresh counts
 *     queue:chunk-failed   → refresh counts (failedCount may have grown)
 *     queue:storage-warning → refresh counts (pendingCount may be near cap)
 *   NetworkMonitor:
 *     network:reconnected  → set isSyncing = true (retryPending() was triggered)
 *     network:offline      → refresh counts (transition to buffering view)
 *
 * Counts are refreshed by calling getQueueStats(); no time-based polling.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import OfflineQueueManager from '../services/queue/OfflineQueueManager';
import NetworkMonitor, { useNetworkStatus } from '../services/network/NetworkMonitor';
import type { SyncStatus } from '../types/offlineQueue';

// ─── State derivation ─────────────────────────────────────────────────────────

function deriveSyncStatus(
  pendingCount: number,
  failedCount: number,
  isOnline: boolean,
  isSyncing: boolean
): SyncStatus {
  if (failedCount > 0) return 'failed';
  if (!isOnline && pendingCount > 0) return 'offline';
  if (isSyncing || (isOnline && pendingCount > 0)) return 'syncing';
  return 'idle';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SyncStatusIndicator() {
  const { isOnline } = useNetworkStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount]   = useState(0);
  const [isSyncing, setIsSyncing]       = useState(false);

  // Rotation animation used in the 'syncing' state.
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  const syncStatus: SyncStatus = deriveSyncStatus(
    pendingCount,
    failedCount,
    isOnline,
    isSyncing
  );

  // ─── Stats refresh ──────────────────────────────────────────────────────────

  const refreshStats = useCallback(async () => {
    try {
      const stats = await OfflineQueueManager.getQueueStats();
      setPendingCount(stats.pendingCount);
      setFailedCount(stats.failedCount);
      // If the queue drained completely, clear the syncing flag.
      if (stats.pendingCount === 0) {
        setIsSyncing(false);
      }
    } catch (err) {
      console.warn('[SyncStatusIndicator] getQueueStats error:', err);
    }
  }, []);

  // ─── Event subscriptions ────────────────────────────────────────────────────

  useEffect(() => {
    refreshStats();

    const unsubSynced = OfflineQueueManager.on('queue:synced', () => {
      setIsSyncing(false);
      refreshStats();
    });

    const unsubFailed = OfflineQueueManager.on('queue:chunk-failed', () => {
      refreshStats();
    });

    const unsubWarning = OfflineQueueManager.on('queue:storage-warning', () => {
      // Storage warning doesn't change sync status, but counts may have grown.
      refreshStats();
    });

    const unsubReconnected = NetworkMonitor.on('network:reconnected', () => {
      // NetworkMonitor called retryPending() — reflect that in the UI.
      setIsSyncing(true);
    });

    const unsubOffline = NetworkMonitor.on('network:offline', () => {
      // Transition to offline state; counts may still be 0 if nothing failed yet.
      refreshStats();
    });

    return () => {
      unsubSynced();
      unsubFailed();
      unsubWarning();
      unsubReconnected();
      unsubOffline();
    };
  }, [refreshStats]);

  // ─── Spin animation ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (syncStatus === 'syncing') {
      spinAnim.setValue(0);
      spinLoop.current = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: Platform.OS !== 'web',
        })
      );
      spinLoop.current.start();
    } else {
      spinLoop.current?.stop();
      spinLoop.current = null;
      spinAnim.setValue(0);
    }

    return () => {
      spinLoop.current?.stop();
    };
  }, [syncStatus, spinAnim]);

  const spin = spinAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ─── Manual retry ────────────────────────────────────────────────────────────

  async function handlePress() {
    setIsSyncing(true);
    try {
      await OfflineQueueManager.retryPending();
    } finally {
      await refreshStats();
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (syncStatus === 'idle') return null;

  // ── Offline ──────────────────────────────────────────────────────────────────
  if (syncStatus === 'offline') {
    return (
      <Pressable
        style={[styles.pill, styles.pillOffline]}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`Offline. Buffering ${pendingCount} audio chunk${pendingCount !== 1 ? 's' : ''}. Tap to retry.`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <View style={[styles.dot, styles.dotOrange]} />
        <Text style={[styles.label, styles.labelOrange]}>
          {`Buffering: ${pendingCount} chunk${pendingCount !== 1 ? 's' : ''}`}
        </Text>
      </Pressable>
    );
  }

  // ── Syncing ───────────────────────────────────────────────────────────────────
  if (syncStatus === 'syncing') {
    return (
      <Pressable
        style={[styles.pill, styles.pillSyncing]}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel="Syncing captured audio. Tap to retry manually."
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <ActivityIndicator
            size="small"
            color={COLORS.green}
            style={styles.spinner}
          />
        </Animated.View>
        <Text style={[styles.label, styles.labelGreen]}>Syncing…</Text>
      </Pressable>
    );
  }

  // ── Failed ────────────────────────────────────────────────────────────────────
  return (
    <Pressable
      style={[styles.pill, styles.pillFailed]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${failedCount} audio chunk${failedCount !== 1 ? 's' : ''} failed to upload. Tap to retry.`}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <View style={[styles.dot, styles.dotRed]} />
      <Text style={[styles.label, styles.labelRed]}>
        {`${failedCount} chunk${failedCount !== 1 ? 's' : ''} failed`}
      </Text>
    </Pressable>
  );
}

// ─── Colours ──────────────────────────────────────────────────────────────────

const COLORS = {
  orange:      '#E8A838',
  orangeText:  '#7A4B00',
  orangeBg:    '#FFF8EC',
  red:         '#A32D2D',
  redText:     '#A32D2D',
  redBg:       '#FEF3EE',
  green:       '#1D9E75',
  greenText:   '#145C44',
  greenBg:     '#E8F7F2',
} as const;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pill: {
    alignSelf:       'center',
    flexDirection:   'row',
    alignItems:      'center',
    gap:             6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius:    99,
    borderWidth:     0.5,
    marginVertical:  4,
  },

  // Per-state backgrounds/borders — matching the existing banner palette in DashboardScreen.
  pillOffline: {
    backgroundColor: COLORS.orangeBg,
    borderColor:     COLORS.orange,
  },
  pillSyncing: {
    backgroundColor: COLORS.greenBg,
    borderColor:     COLORS.green,
  },
  pillFailed: {
    backgroundColor: COLORS.redBg,
    borderColor:     COLORS.red,
  },

  // Dot (offline / failed states)
  dot: {
    width:        7,
    height:       7,
    borderRadius: 99,
  },
  dotOrange: { backgroundColor: COLORS.orange },
  dotRed:    { backgroundColor: COLORS.red },

  // ActivityIndicator wrapper (syncing state)
  spinner: {
    width:  14,
    height: 14,
  },

  // Label
  label: {
    fontSize:   12,
    fontWeight: '500',
  },
  labelOrange: { color: COLORS.orangeText },
  labelGreen:  { color: COLORS.greenText },
  labelRed:    { color: COLORS.redText },
});
