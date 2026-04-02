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

import { capabilities } from '../../config/capabilities';
import { IRepository } from '../interfaces/IRepository';
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

    const adapter = await this.createAdapter();
    await adapter.initialize();

    this.instance = adapter;
    return adapter;
  }

  /**
   * Create adapter based on current platform
   * Uses dynamic import for SqliteAdapter to avoid bundling on web
   */
  private static async createAdapter(): Promise<IRepository> {
    const platform = capabilities.platform;

    console.log(`[RepositoryFactory] Detected platform: ${platform}`);

    switch (platform) {
      case 'android':
      case 'ios':
        console.log('[RepositoryFactory] Using SqliteAdapter');
        // Dynamic import to avoid bundling expo-sqlite on web
        const { SqliteAdapter } = await import('./sqlite/SqliteAdapter');
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
