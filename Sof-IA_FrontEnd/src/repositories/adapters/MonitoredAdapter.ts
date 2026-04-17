/**
 * MonitoredAdapter - Performance and error tracking wrapper
 *
 * Wraps any IRepository implementation with:
 * - Performance monitoring
 * - Error tracking and retry logic
 * - Operation logging
 * - Metrics collection
 */

import { IRepository, WhereClause } from '../interfaces/IRepository';
import { StorageConfig, LogLevel } from './StorageConfig';

export class MonitoredAdapter implements IRepository {
  private adapter: IRepository;
  private config: StorageConfig;
  private operationCount: Map<string, number> = new Map();
  private errorCount: Map<string, number> = new Map();

  constructor(adapter: IRepository, config: StorageConfig) {
    this.adapter = adapter;
    this.config = config;
  }

  /**
   * Execute operation with monitoring and retry logic
   */
  private async executeWithMonitoring<T>(
    operationName: string,
    operation: () => Promise<T>,
    retryable: boolean = true
  ): Promise<T> {
    const startTime = Date.now();
    const maxRetries = retryable ? (this.config.maxRetries ?? 3) : 1;
    let lastError: Error | null = null;

    // Increment operation count
    this.operationCount.set(operationName, (this.operationCount.get(operationName) ?? 0) + 1);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await operation();
        const duration = Date.now() - startTime;

        // Log performance
        this.logPerformance(operationName, duration, attempt);

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Increment error count
        this.errorCount.set(operationName, (this.errorCount.get(operationName) ?? 0) + 1);

        // Log error
        this.logError(operationName, lastError, attempt + 1, maxRetries);

        // Call custom error handler
        if (this.config.onError) {
          this.config.onError(lastError, operationName);
        }

        // Retry logic
        if (attempt < maxRetries - 1) {
          const delay = (this.config.retryDelay ?? 1000) * Math.pow(2, attempt);
          this.log(LogLevel.INFO, `Retrying ${operationName} in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Log performance metrics
   */
  private logPerformance(operation: string, duration: number, retries: number): void {
    if (!this.config.enablePerformanceMonitoring) {
      return;
    }

    const threshold = this.config.slowQueryThreshold ?? 1000;

    if (duration > threshold) {
      this.log(
        LogLevel.WARN,
        `Slow operation: ${operation} took ${duration}ms${retries > 0 ? ` (${retries} retries)` : ''}`
      );

      if (this.config.onSlowQuery) {
        this.config.onSlowQuery(operation, duration, { retries, threshold });
      }
    } else {
      this.log(LogLevel.DEBUG, `${operation} completed in ${duration}ms`);
    }
  }

  /**
   * Log errors
   */
  private logError(operation: string, error: Error, attempt: number, maxAttempts: number): void {
    const level = attempt >= maxAttempts ? LogLevel.ERROR : LogLevel.WARN;
    this.log(level, `${operation} failed (attempt ${attempt}/${maxAttempts}):`, error.message);
  }

  /**
   * Logging helper
   */
  private log(level: LogLevel, ...args: any[]): void {
    if (!this.config.enableLogging) {
      return;
    }

    const configLevel = this.config.logLevel ?? LogLevel.INFO;
    const levels = [LogLevel.NONE, LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];

    if (levels.indexOf(level) <= levels.indexOf(configLevel)) {
      const prefix = `[MonitoredAdapter:${level.toUpperCase()}]`;

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
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get operation statistics
   */
  getStatistics(): {
    operations: Map<string, number>;
    errors: Map<string, number>;
    errorRate: number;
  } {
    const totalOps = Array.from(this.operationCount.values()).reduce((a, b) => a + b, 0);
    const totalErrors = Array.from(this.errorCount.values()).reduce((a, b) => a + b, 0);

    return {
      operations: new Map(this.operationCount),
      errors: new Map(this.errorCount),
      errorRate: totalOps > 0 ? totalErrors / totalOps : 0,
    };
  }

  // ========================================
  // IRepository interface implementation
  // ========================================

  async create<T>(store: string, data: Partial<T>): Promise<T> {
    return this.executeWithMonitoring(`create:${store}`, () => this.adapter.create(store, data));
  }

  async findByField<T>(store: string, field: string, value: any): Promise<T[]> {
    return this.executeWithMonitoring(`findByField:${store}`, () =>
      this.adapter.findByField(store, field, value)
    );
  }

  async read<T>(store: string, id: string): Promise<T | null> {
    return this.executeWithMonitoring(`read:${store}`, () => this.adapter.read(store, id));
  }

  async update<T>(store: string, id: string, data: Partial<T>): Promise<T> {
    return this.executeWithMonitoring(`update:${store}`, () =>
      this.adapter.update(store, id, data)
    );
  }

  async delete(store: string, id: string): Promise<void> {
    return this.executeWithMonitoring(`delete:${store}`, () => this.adapter.delete(store, id));
  }

  async queryBySession<T>(store: string, sessionId: string): Promise<T[]> {
    return this.executeWithMonitoring(`queryBySession:${store}`, () =>
      this.adapter.queryBySession(store, sessionId)
    );
  }

  async bulkDelete(store: string, where: WhereClause): Promise<number> {
    return this.executeWithMonitoring(`bulkDelete:${store}`, () =>
      this.adapter.bulkDelete(store, where)
    );
  }

  async purgeExpired(): Promise<number> {
    return this.executeWithMonitoring('purgeExpired', () => this.adapter.purgeExpired(), false);
  }
}
