/**
 * StorageFactory - Advanced runtime adapter selection and management
 *
 * Features:
 * - Automatic platform detection via Platform.OS
 * - Runtime adapter selection (SQLite for native, IndexedDB for web)
 * - Configuration-based customization
 * - Health checks and fallback mechanisms
 * - Performance monitoring
 * - Error handling and retry logic
 * - Singleton pattern with lifecycle management
 *
 * Usage:
 * ```typescript
 * // Simple usage (auto-detect platform)
 * const storage = await StorageFactory.create();
 *
 * // With configuration
 * const storage = await StorageFactory.create({
 *   databaseName: 'my_app_db',
 *   enableLogging: true,
 *   enablePerformanceMonitoring: true,
 * });
 * ```
 */

import { IRepository } from '../interfaces/IRepository';
import { SqliteAdapter } from './sqlite/SqliteAdapter';
import { DexieAdapter } from './dexie/DexieAdapter';
import {
  PlatformDetector,
  StoragePlatform,
  AdapterType,
  PlatformCapabilities,
} from './PlatformDetector';
import {
  StorageConfig,
  mergeConfig,
  validateConfig,
  LogLevel,
} from './StorageConfig';

/**
 * Adapter health status
 */
export interface AdapterHealth {
  healthy: boolean;
  lastCheck: string;
  errorCount: number;
  lastError?: string;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  totalOperations: number;
  totalDuration: number;
  averageDuration: number;
  slowestOperation: {
    operation: string;
    duration: number;
    timestamp: string;
  } | null;
}

export class StorageFactory {
  private static instance: IRepository | null = null;
  private static config: StorageConfig = {};
  private static adapterType: AdapterType | null = null;
  private static platformCapabilities: PlatformCapabilities | null = null;
  private static health: AdapterHealth = {
    healthy: true,
    lastCheck: new Date().toISOString(),
    errorCount: 0,
  };
  private static metrics: PerformanceMetrics = {
    totalOperations: 0,
    totalDuration: 0,
    averageDuration: 0,
    slowestOperation: null,
  };
  private static healthCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Create or get singleton storage instance
   * Automatically selects adapter based on Platform.OS
   *
   * @param config - Optional configuration options
   * @returns Initialized storage adapter
   */
  static async create(config?: Partial<StorageConfig>): Promise<IRepository> {
    // If instance exists and config hasn't changed, return it
    if (this.instance && !config) {
      return this.instance;
    }

    // If config changed, reset and recreate
    if (this.instance && config) {
      await this.destroy();
    }

    // Merge with defaults and validate
    this.config = mergeConfig(config);
    validateConfig(this.config);

    // Detect platform capabilities
    this.platformCapabilities = PlatformDetector.detect();
    this.log(LogLevel.INFO, 'Platform detected:', this.platformCapabilities.platform);

    // Create adapter
    const adapter = await this.createAdapter();

    // Initialize adapter
    try {
      await this.initializeAdapter(adapter);
      this.instance = adapter;
      this.health.healthy = true;
      this.health.errorCount = 0;

      // Purge expired records on every cold startup
      try {
        const purged = await adapter.purgeExpired();
        if (purged > 0) {
          this.log(LogLevel.INFO, `Purged ${purged} expired record(s) on startup`);
        }
      } catch (purgeError) {
        this.log(LogLevel.WARN, 'purgeExpired on startup failed (non-fatal):', purgeError);
      }

      // Start health checks if enabled
      if (this.config.enableHealthChecks) {
        this.startHealthChecks();
      }

      this.log(LogLevel.INFO, `Storage adapter initialized: ${this.adapterType}`);
      return adapter;
    } catch (error) {
      this.log(LogLevel.ERROR, 'Failed to initialize adapter:', error);
      this.health.healthy = false;
      this.health.errorCount++;
      this.health.lastError = error instanceof Error ? error.message : String(error);

      // Try fallback if enabled
      if (this.config.enableFallback) {
        return await this.createFallbackAdapter();
      }

      throw error;
    }
  }

  /**
   * Create adapter based on platform detection or forced config
   */
  private static async createAdapter(): Promise<IRepository> {
    // Check for forced adapter type
    if (this.config.forceAdapter) {
      this.adapterType = this.config.forceAdapter;
      this.log(LogLevel.WARN, `Using forced adapter: ${this.adapterType}`);
      return this.instantiateAdapter(this.adapterType);
    }

    // Auto-detect based on platform
    const recommendedType = this.platformCapabilities!.recommendedAdapter;
    this.adapterType = recommendedType;

    this.log(LogLevel.INFO, `Using recommended adapter: ${recommendedType}`);
    return this.instantiateAdapter(recommendedType);
  }

  /**
   * Instantiate specific adapter type
   */
  private static instantiateAdapter(type: AdapterType): IRepository {
    const dbName = this.getDatabaseName();

    switch (type) {
      case AdapterType.SQLITE:
        if (!PlatformDetector.canUseSQLite()) {
          throw new Error('SQLite not supported on this platform');
        }
        this.log(LogLevel.DEBUG, `Creating SqliteAdapter with database: ${dbName}.db`);
        return new SqliteAdapter(`${dbName}.db`);

      case AdapterType.INDEXEDDB:
        if (!PlatformDetector.canUseIndexedDB()) {
          throw new Error('IndexedDB not supported on this platform');
        }
        this.log(LogLevel.DEBUG, `Creating DexieAdapter with database: ${dbName}_db`);
        return new DexieAdapter(`${dbName}_db`);

      case AdapterType.MEMORY:
        this.log(LogLevel.WARN, 'Using in-memory storage (data will not persist)');
        // TODO: Implement in-memory adapter for unsupported platforms
        throw new Error('In-memory adapter not yet implemented');

      default:
        throw new Error(`Unknown adapter type: ${type}`);
    }
  }

  /**
   * Initialize adapter with retry logic
   */
  private static async initializeAdapter(adapter: IRepository): Promise<void> {
    const maxRetries = this.config.maxRetries ?? 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        await (adapter as any).initialize();
        const duration = Date.now() - startTime;

        this.recordPerformance('initialize', duration);
        this.log(LogLevel.INFO, `Adapter initialized in ${duration}ms`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log(
          LogLevel.WARN,
          `Initialization attempt ${attempt + 1}/${maxRetries} failed:`,
          error
        );

        if (attempt < maxRetries - 1) {
          const delay = (this.config.retryDelay ?? 1000) * Math.pow(2, attempt);
          this.log(LogLevel.INFO, `Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`Failed to initialize adapter after ${maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Create fallback adapter (in-memory or alternative)
   */
  private static async createFallbackAdapter(): Promise<IRepository> {
    this.log(LogLevel.WARN, 'Attempting fallback adapter...');

    // Try alternative adapters
    const platform = this.platformCapabilities!.platform;

    try {
      if (platform === StoragePlatform.WEB && this.platformCapabilities!.supportsIndexedDB) {
        this.log(LogLevel.INFO, 'Falling back to IndexedDB');
        const adapter = new DexieAdapter(`${this.getDatabaseName()}_fallback`);
        await (adapter as any).initialize();
        this.instance = adapter;
        return adapter;
      }

      if (
        (platform === StoragePlatform.ANDROID || platform === StoragePlatform.IOS) &&
        this.platformCapabilities!.supportsSQLite
      ) {
        this.log(LogLevel.INFO, 'Falling back to SQLite');
        const adapter = new SqliteAdapter(`${this.getDatabaseName()}_fallback.db`);
        await (adapter as any).initialize();
        this.instance = adapter;
        return adapter;
      }
    } catch (error) {
      this.log(LogLevel.ERROR, 'Fallback adapter also failed:', error);
    }

    throw new Error('No suitable fallback adapter available');
  }

  /**
   * Get database name from config or default
   */
  private static getDatabaseName(): string {
    return this.config.databaseName ?? 'sofia';
  }

  /**
   * Start periodic health checks
   */
  private static startHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    const interval = this.config.healthCheckInterval ?? 300000; // 5 minutes

    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, interval);

    this.log(LogLevel.DEBUG, `Health checks scheduled every ${interval}ms`);
  }

  /**
   * Perform health check on current adapter
   */
  static async performHealthCheck(): Promise<boolean> {
    if (!this.instance) {
      this.log(LogLevel.WARN, 'Cannot perform health check: no adapter instance');
      return false;
    }

    try {
      this.log(LogLevel.DEBUG, 'Performing health check...');

      // Try a simple read operation
      const startTime = Date.now();
      await this.instance.read('sessions', 'health_check_dummy_id');
      const duration = Date.now() - startTime;

      this.health.healthy = true;
      this.health.lastCheck = new Date().toISOString();

      this.log(LogLevel.DEBUG, `Health check passed (${duration}ms)`);
      return true;
    } catch (error) {
      this.health.healthy = false;
      this.health.errorCount++;
      this.health.lastError = error instanceof Error ? error.message : String(error);
      this.health.lastCheck = new Date().toISOString();

      this.log(LogLevel.ERROR, 'Health check failed:', error);

      if (this.config.onHealthCheckFailed) {
        this.config.onHealthCheckFailed(error instanceof Error ? error : new Error(String(error)));
      }

      return false;
    }
  }

  /**
   * Record performance metrics
   */
  private static recordPerformance(operation: string, duration: number): void {
    if (!this.config.enablePerformanceMonitoring) {
      return;
    }

    this.metrics.totalOperations++;
    this.metrics.totalDuration += duration;
    this.metrics.averageDuration = this.metrics.totalDuration / this.metrics.totalOperations;

    // Track slowest operation
    if (!this.metrics.slowestOperation || duration > this.metrics.slowestOperation.duration) {
      this.metrics.slowestOperation = {
        operation,
        duration,
        timestamp: new Date().toISOString(),
      };
    }

    // Log slow queries
    const threshold = this.config.slowQueryThreshold ?? 1000;
    if (duration > threshold) {
      this.log(LogLevel.WARN, `Slow operation detected: ${operation} took ${duration}ms`);

      if (this.config.onSlowQuery) {
        this.config.onSlowQuery(operation, duration, { threshold });
      }
    }
  }

  /**
   * Get current adapter health status
   */
  static getHealth(): AdapterHealth {
    return { ...this.health };
  }

  /**
   * Get performance metrics
   */
  static getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Get platform capabilities
   */
  static getCapabilities(): PlatformCapabilities | null {
    return this.platformCapabilities ? { ...this.platformCapabilities } : null;
  }

  /**
   * Get current adapter type
   */
  static getAdapterType(): AdapterType | null {
    return this.adapterType;
  }

  /**
   * Get current configuration
   */
  static getConfig(): StorageConfig {
    return { ...this.config };
  }

  /**
   * Check if storage is initialized
   */
  static isInitialized(): boolean {
    return this.instance !== null;
  }

  /**
   * Get current instance (if initialized)
   */
  static getInstance(): IRepository | null {
    return this.instance;
  }

  /**
   * Destroy current instance and cleanup resources
   */
  static async destroy(): Promise<void> {
    this.log(LogLevel.INFO, 'Destroying storage instance...');

    // Stop health checks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Close adapter connection
    if (this.instance && typeof (this.instance as any).close === 'function') {
      try {
        await (this.instance as any).close();
      } catch (error) {
        this.log(LogLevel.ERROR, 'Error closing adapter:', error);
      }
    }

    this.instance = null;
    this.adapterType = null;
    this.log(LogLevel.INFO, 'Storage instance destroyed');
  }

  /**
   * Reset factory state (for testing)
   */
  static reset(): void {
    this.instance = null;
    this.config = {};
    this.adapterType = null;
    this.platformCapabilities = null;
    this.health = {
      healthy: true,
      lastCheck: new Date().toISOString(),
      errorCount: 0,
    };
    this.metrics = {
      totalOperations: 0,
      totalDuration: 0,
      averageDuration: 0,
      slowestOperation: null,
    };

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    PlatformDetector.reset();
  }

  /**
   * Logging helper
   */
  private static log(level: LogLevel, ...args: any[]): void {
    if (!this.config.enableLogging) {
      return;
    }

    const configLevel = this.config.logLevel ?? LogLevel.INFO;
    const levels = [LogLevel.NONE, LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];

    if (levels.indexOf(level) <= levels.indexOf(configLevel)) {
      const prefix = `[StorageFactory:${level.toUpperCase()}]`;

      switch (level) {
        case LogLevel.ERROR:
          console.error(prefix, ...args);
          break;
        case LogLevel.WARN:
          console.warn(prefix, ...args);
          break;
        default:
          console.log(prefix, ...args);
      }
    }
  }

  /**
   * Sleep helper for retry delays
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Convenience function to get storage instance
 * Alias for StorageFactory.create() for backward compatibility
 */
export async function getStorage(config?: Partial<StorageConfig>): Promise<IRepository> {
  return await StorageFactory.create(config);
}
