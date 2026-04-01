/**
 * Storage Adapters - Platform-specific implementations
 *
 * Export all adapters, factories, and utilities for unified data access.
 */

// Adapters
export { SqliteAdapter } from './sqlite/SqliteAdapter';
export { DexieAdapter } from './dexie/DexieAdapter';
export { MonitoredAdapter } from './MonitoredAdapter';

// Factories
export { RepositoryFactory, getRepository } from './RepositoryFactory';
export {
  StorageFactory,
  getStorage,
  type AdapterHealth,
  type PerformanceMetrics,
} from './StorageFactory';

// Platform Detection
export {
  PlatformDetector,
  StoragePlatform,
  AdapterType,
  type PlatformCapabilities,
} from './PlatformDetector';

// Configuration
export {
  type StorageConfig,
  LogLevel,
  DEFAULT_STORAGE_CONFIG,
  mergeConfig,
  validateConfig,
} from './StorageConfig';

// SQLite utilities
export { migrations, runMigrations, initializeDatabase } from './sqlite/migrations';
