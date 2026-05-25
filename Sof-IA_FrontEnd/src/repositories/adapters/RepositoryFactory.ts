/**
 * RepositoryFactory - Platform-aware adapter instantiation
 *
 * Automatically selects the correct storage adapter based on platform:
 * - Android/iOS: SqliteAdapter (expo-sqlite)
 * - Web: DexieAdapter (Dexie.js/IndexedDB)
 *
 * Usage:
 * ```typescript
 * const repository = await RepositoryFactory.create();
 * // Now use repository.create(), repository.read(), etc.
 * ```
 *
 * Note: Uses dynamic imports to avoid bundling native modules on web
 */

import { IRepository } from '../interfaces/IRepository';
import { StorageFactory } from './StorageFactory';

// RepositoryFactory delegates entirely to StorageFactory so the app always
// uses a single SqliteAdapter instance. Having two adapters open the same
// database file simultaneously causes NullPointerException in prepareAsync.
export class RepositoryFactory {
  static async create(): Promise<IRepository> {
    return StorageFactory.create();
  }

  static reset(): void {
    StorageFactory.reset();
  }

  static getInstance(): IRepository | null {
    return StorageFactory.getInstance();
  }

  static isInitialized(): boolean {
    return StorageFactory.isInitialized();
  }
}

export async function getRepository(): Promise<IRepository> {
  return StorageFactory.create();
}
