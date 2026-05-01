/**
 * backgroundQueueSync — Android/iOS background task for offline queue drain.
 *
 * Uses expo-task-manager + expo-background-fetch to call
 * OfflineQueueManager.retryPending() even when the app is in the background.
 *
 * ─── Installation ────────────────────────────────────────────────────────────
 * These packages are not yet in package.json. Add them before building:
 *
 *   npx expo install expo-task-manager expo-background-fetch
 *
 * Then add the background fetch permission to app.json:
 *   "android": { "permissions": ["android.permission.RECEIVE_BOOT_COMPLETED"] }
 *
 * ─── Registration requirement ────────────────────────────────────────────────
 * THIS FILE must be imported in index.js BEFORE registerRootComponent() so that
 * TaskManager.defineTask() is called before the task manager starts up:
 *
 *   // index.js
 *   import './src/tasks/backgroundQueueSync';
 *   import { registerRootComponent } from 'expo';
 *   import App from './App';
 *   registerRootComponent(App);
 *
 * ─── Lifecycle ────────────────────────────────────────────────────────────────
 *   registerBackgroundQueueSync()   — call in ContinuousRecordingService.initialize()
 *   unregisterBackgroundQueueSync() — call in EndShiftService._stopBackgroundTasks()
 *
 * The task is not started on device boot (startOnBoot: false) because an
 * active shift is required for the queue to make sense.
 */

import { Platform } from 'react-native';
import OfflineQueueManager from '../services/queue/OfflineQueueManager';

export const BACKGROUND_QUEUE_SYNC_TASK = 'background-queue-sync';

/** Minimum OS-level interval between background fetch callbacks (15 min). */
const MIN_INTERVAL_SECONDS = 15 * 60;

// ─── Task definition ──────────────────────────────────────────────────────────
// defineTask() MUST be called at module scope (synchronously, before the app
// renders). Dynamic require() is synchronous in React Native's Metro bundler,
// so this is safe. The try/catch guards against packages not yet installed.

if (Platform.OS !== 'web') {
  try {
    const TaskManager = require('expo-task-manager');
    const BackgroundFetch = require('expo-background-fetch');

    TaskManager.defineTask(
      BACKGROUND_QUEUE_SYNC_TASK,
      async (): Promise<typeof BackgroundFetch.BackgroundFetchResult[keyof typeof BackgroundFetch.BackgroundFetchResult]> => {
        try {
          console.log('[BackgroundQueueSync] Task running');
          const syncedCount = await OfflineQueueManager.retryPending();
          console.log(`[BackgroundQueueSync] Synced ${syncedCount} chunk(s)`);

          return syncedCount > 0
            ? BackgroundFetch.BackgroundFetchResult.NewData
            : BackgroundFetch.BackgroundFetchResult.NoData;
        } catch (err) {
          console.error('[BackgroundQueueSync] Task error:', err);
          return BackgroundFetch.BackgroundFetchResult.Failed;
        }
      }
    );

    console.log('[BackgroundQueueSync] Task defined');
  } catch (_) {
    console.warn(
      '[BackgroundQueueSync] expo-task-manager / expo-background-fetch not available. ' +
        'Run: npx expo install expo-task-manager expo-background-fetch'
    );
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────

/**
 * Register the background queue sync task with the OS.
 * Call once when a shift starts (e.g., in ContinuousRecordingService.initialize()).
 * No-op on web or if the packages are not installed.
 */
export async function registerBackgroundQueueSync(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const BackgroundFetch = require('expo-background-fetch');
    const TaskManager = require('expo-task-manager');

    // Avoid double-registration
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_QUEUE_SYNC_TASK);
    if (isRegistered) {
      console.log('[BackgroundQueueSync] Already registered — skipping');
      return;
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_QUEUE_SYNC_TASK, {
      minimumInterval: MIN_INTERVAL_SECONDS,
      /** Keep running after the user force-stops the app (Android). */
      stopOnTerminate: false,
      /** Don't wake the device on reboot — the nurse must start a shift first. */
      startOnBoot: false,
    });

    console.log('[BackgroundQueueSync] Registered (interval ≥', MIN_INTERVAL_SECONDS, 's)');
  } catch (err) {
    // Non-fatal — foreground / NetworkMonitor retries are the primary path.
    console.warn('[BackgroundQueueSync] registerTaskAsync failed:', err);
  }
}

// ─── Unregister ───────────────────────────────────────────────────────────────

/**
 * Unregister the background task.
 * Call when the shift ends so the OS stops waking the app for a logged-out nurse.
 * No-op on web or if the task is not registered.
 */
export async function unregisterBackgroundQueueSync(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const BackgroundFetch = require('expo-background-fetch');
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_QUEUE_SYNC_TASK);
    console.log('[BackgroundQueueSync] Unregistered');
  } catch (_) {
    // Task may not have been registered — that's fine.
  }
}
