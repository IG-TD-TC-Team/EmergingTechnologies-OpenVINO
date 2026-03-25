/**
 * StorageConfig - Configuration options for storage adapters
 *
 * Provides type-safe configuration for runtime adapter customization.
 */

import { AdapterType } from './PlatformDetector';

/**
 * Logging levels
 */
export enum LogLevel {
  NONE = 'none',
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

/**
 * Storage configuration options
 */
export interface StorageConfig {
  /**
   * Database name for the storage adapter
   * @default "sofia.db" for SQLite, "sofia_db" for IndexedDB
   */
  databaseName?: string;

  /**
   * Force specific adapter (overrides platform detection)
   * Use for testing or specific requirements
   */
  forceAdapter?: AdapterType;

  /**
   * Enable debug logging
   * @default false
   */
  enableLogging?: boolean;

  /**
   * Logging level
   * @default LogLevel.INFO
   */
  logLevel?: LogLevel;

  /**
   * Enable performance monitoring
   * Tracks operation times and logs slow queries
   * @default false
   */
  enablePerformanceMonitoring?: boolean;

  /**
   * Slow query threshold in milliseconds
   * Queries taking longer than this will be logged
   * @default 1000 (1 second)
   */
  slowQueryThreshold?: number;

  /**
   * Enable automatic health checks
   * Periodically verifies adapter is functioning
   * @default true
   */
  enableHealthChecks?: boolean;

  /**
   * Health check interval in milliseconds
   * @default 300000 (5 minutes)
   */
  healthCheckInterval?: number;

  /**
   * Enable fallback to in-memory storage on errors
   * @default true
   */
  enableFallback?: boolean;

  /**
   * Maximum retry attempts for failed operations
   * @default 3
   */
  maxRetries?: number;

  /**
   * Retry delay in milliseconds (exponential backoff)
   * @default 1000
   */
  retryDelay?: number;

  /**
   * Enable automatic migration on initialization
   * @default true
   */
  autoMigrate?: boolean;

  /**
   * Enable WAL mode for SQLite (if supported)
   * @default true
   */
  enableWAL?: boolean;

  /**
   * Custom error handler
   */
  onError?: (error: Error, operation: string) => void;

  /**
   * Custom performance logger
   */
  onSlowQuery?: (operation: string, duration: number, details: any) => void;

  /**
   * Custom health check handler
   */
  onHealthCheckFailed?: (error: Error) => void;
}

/**
 * Default storage configuration
 */
export const DEFAULT_STORAGE_CONFIG: Required<
  Omit<StorageConfig, 'forceAdapter' | 'onError' | 'onSlowQuery' | 'onHealthCheckFailed'>
> = {
  databaseName: 'sofia',
  enableLogging: false,
  logLevel: LogLevel.INFO,
  enablePerformanceMonitoring: false,
  slowQueryThreshold: 1000,
  enableHealthChecks: true,
  healthCheckInterval: 300000,
  enableFallback: true,
  maxRetries: 3,
  retryDelay: 1000,
  autoMigrate: true,
  enableWAL: true,
};

/**
 * Merge user config with defaults
 */
export function mergeConfig(userConfig?: Partial<StorageConfig>): StorageConfig {
  return {
    ...DEFAULT_STORAGE_CONFIG,
    ...userConfig,
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: StorageConfig): void {
  if (config.slowQueryThreshold && config.slowQueryThreshold < 0) {
    throw new Error('slowQueryThreshold must be >= 0');
  }

  if (config.healthCheckInterval && config.healthCheckInterval < 1000) {
    throw new Error('healthCheckInterval must be >= 1000ms');
  }

  if (config.maxRetries && config.maxRetries < 0) {
    throw new Error('maxRetries must be >= 0');
  }

  if (config.retryDelay && config.retryDelay < 0) {
    throw new Error('retryDelay must be >= 0');
  }
}
