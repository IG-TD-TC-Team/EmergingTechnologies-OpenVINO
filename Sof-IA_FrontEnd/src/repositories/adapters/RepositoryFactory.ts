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
 */

import { Platform } from 'react-native';
import { IRepository } from '../interfaces/IRepository';
import { SqliteAdapter } from './sqlite/SqliteAdapter';
import { DexieAdapter } from './dexie/DexieAdapter';

export class RepositoryFactory {
  private static instance: IRepository | null = null;

  /**
   * Create or get singleton repository instance
   * Automatically selects adapter based on platform
   */
  static async create(): Promise<IRepository> {
    if (this.instance) {
      return this.instance;
    }

    const adapter = this.createAdapter();
    await adapter.initialize();

    this.instance = adapter;
    return adapter;
  }

  /**
   * Create adapter based on current platform
   */
  private static createAdapter(): IRepository {
    const platform = Platform.OS;

    console.log(`[RepositoryFactory] Detected platform: ${platform}`);

    switch (platform) {
      case 'android':
      case 'ios':
        console.log('[RepositoryFactory] Using SqliteAdapter');
        return new SqliteAdapter();

      case 'web':
        console.log('[RepositoryFactory] Using DexieAdapter');
        return new DexieAdapter();

      default:
        // Fallback to Dexie for unknown platforms
        console.warn(`[RepositoryFactory] Unknown platform: ${platform}, falling back to DexieAdapter`);
        return new DexieAdapter();
    }
  }

  /**
   * Reset singleton instance (for testing)
   */
  static reset(): void {
    this.instance = null;
    console.log('[RepositoryFactory] Instance reset');
  }

  /**
   * Get current adapter instance (if initialized)
   */
  static getInstance(): IRepository | null {
    return this.instance;
  }

  /**
   * Check if repository is initialized
   */
  static isInitialized(): boolean {
    return this.instance !== null;
  }
}

/**
 * Convenience function to get repository instance
 */
export async function getRepository(): Promise<IRepository> {
  return await RepositoryFactory.create();
}
