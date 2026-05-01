/**
 * Offline Queue — public entry point.
 *
 * The rest of the app imports only from here.  Platform selection is done
 * once at module load time: the rest of the codebase never touches
 * DexieQueueRepository or SQLiteQueueRepository directly.
 *
 * Usage:
 *   import { getOfflineQueueRepository } from '@/services/queue';
 *   const queue = await getOfflineQueueRepository();
 *   await queue.enqueue(entry);
 */

import { Platform } from 'react-native';
import { IOfflineQueueRepository } from './IOfflineQueueRepository';

export type { IOfflineQueueRepository };
export type { OfflineQueueEntry, SyncStatus } from '../../types/offlineQueue';

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: IOfflineQueueRepository | null = null;

/**
 * Return the platform-appropriate repository, initialised on first call.
 *
 * - Web  (Platform.OS === 'web')  → DexieQueueRepository  (IndexedDB)
 * - Android / iOS                 → SQLiteQueueRepository (expo-sqlite)
 *
 * Subsequent calls return the cached singleton; pass `reset: true` only in tests.
 */
export async function getOfflineQueueRepository(
  options: { reset?: boolean } = {}
): Promise<IOfflineQueueRepository> {
  if (_instance && !options.reset) return _instance;

  if (Platform.OS === 'web') {
    const { DexieQueueRepository } = await import('./DexieQueueRepository');
    _instance = new DexieQueueRepository();
  } else {
    const { SQLiteQueueRepository } = await import('./SQLiteQueueRepository');
    const repo = new SQLiteQueueRepository();
    await repo.initialize();
    _instance = repo;
  }

  return _instance;
}
