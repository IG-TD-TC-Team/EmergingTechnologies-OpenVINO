/**
 * useQueueNotifications — implementation
 *
 * Kept in .tsx because the QueueNotifications render function contains JSX.
 * Public entry point: hooks/useQueueNotifications.ts (re-exports this).
 *
 * Subscribes to offline queue and network events and returns a single
 * <QueueNotifications /> component to render once in the dashboard.
 *
 * Rendered elements:
 *   Toast          — auto-dismisses after 3 500 ms (same pattern as resumedBanner)
 *   StorageBanner  — persistent until the warning condition clears
 *
 * Events handled:
 *   network:reconnected     → toast  "Back online. Syncing captured audio…"
 *   queue:chunk-failed      → toast  "A recorded chunk could not be sent. It will
 *                                      be retried when possible."
 *   queue:storage-warning   → show StorageBanner  "Storage nearly full. Connect to sync."
 *   queue:synced            → hide StorageBanner (queue drained — warning resolved)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import OfflineQueueManager from '../services/queue/OfflineQueueManager';
import NetworkMonitor from '../services/network/NetworkMonitor';

// ─── Toast messages ───────────────────────────────────────────────────────────

const TOAST_RECONNECTED  = 'Back online. Syncing captured audio…';
const TOAST_CHUNK_FAILED = 'A recorded chunk could not be sent. It will be retried when possible.';
const STORAGE_WARNING    = 'Storage nearly full. Connect to sync.';

/** Auto-dismiss delay in ms — matches the resumedBanner pattern in DashboardScreen. */
const TOAST_DURATION_MS = 3_500;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useQueueNotifications() {
  const [toastMessage, setToastMessage]     = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);

  // Keep a ref to the active dismiss timer so we can reset it if a new toast
  // fires before the previous one has dismissed.
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);

    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
    }
    dismissTimer.current = setTimeout(() => {
      setToastMessage(null);
      dismissTimer.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  // ─── Event subscriptions ──────────────────────────────────────────────────

  useEffect(() => {
    const unsubReconnected = NetworkMonitor.on('network:reconnected', () => {
      showToast(TOAST_RECONNECTED);
    });

    const unsubChunkFailed = OfflineQueueManager.on('queue:chunk-failed', () => {
      showToast(TOAST_CHUNK_FAILED);
    });

    const unsubStorageWarning = OfflineQueueManager.on('queue:storage-warning', () => {
      setStorageWarning(true);
    });

    // Dismiss the storage warning when the queue has fully synced.
    const unsubSynced = OfflineQueueManager.on('queue:synced', () => {
      setStorageWarning(false);
    });

    return () => {
      unsubReconnected();
      unsubChunkFailed();
      unsubStorageWarning();
      unsubSynced();
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
      }
    };
  }, [showToast]);

  // ─── Renderable component ─────────────────────────────────────────────────

  function QueueNotifications() {
    if (!toastMessage && !storageWarning) return null;

    return (
      <>
        {storageWarning && (
          <View
            style={[styles.banner, styles.bannerWarning]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text style={[styles.bannerText, styles.bannerTextWarning]}>
              {STORAGE_WARNING}
            </Text>
          </View>
        )}

        {toastMessage !== null && (
          <View
            style={styles.toast}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        )}
      </>
    );
  }

  return { QueueNotifications };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Persistent storage-warning banner — matches MicPermissionBanner layout
  banner: {
    flexDirection:     'row',
    alignItems:        'center',
    borderWidth:       0.5,
    borderRadius:      8,
    paddingHorizontal: 12,
    paddingVertical:   10,
    marginHorizontal:  16,
    marginTop:         8,
  },
  bannerWarning: {
    backgroundColor: '#FFF8EC',
    borderColor:     '#E8A838',
  },
  bannerText: {
    flex:       1,
    fontSize:   13,
    lineHeight: 18,
  },
  bannerTextWarning: {
    color: '#7A4B00',
  },

  // Auto-dismissing toast — matches resumedBanner style in DashboardScreen
  toast: {
    alignSelf:         'center',
    backgroundColor:   '#1D1B20',
    borderRadius:      8,
    paddingHorizontal: 14,
    paddingVertical:   9,
    marginHorizontal:  16,
    marginTop:         8,
  },
  toastText: {
    color:      '#FFFFFF',
    fontSize:   13,
    lineHeight: 18,
    textAlign:  'center',
  },
});
