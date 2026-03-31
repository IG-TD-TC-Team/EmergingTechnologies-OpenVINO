# StorageFactory - Runtime Adapter Selection Guide

Complete guide to using the StorageFactory for automatic platform-aware storage selection.

## Overview

`StorageFactory` provides **runtime adapter selection** based on `Platform.OS` with:

- ✅ **Automatic Platform Detection** - Detects Android/iOS/Web and selects appropriate adapter
- ✅ **Configuration-Based Customization** - Fine-tune behavior via StorageConfig
- ✅ **Health Monitoring** - Automatic health checks with fallback mechanisms
- ✅ **Performance Tracking** - Operation timing and slow query detection
- ✅ **Error Handling** - Retry logic with exponential backoff
- ✅ **Singleton Pattern** - One instance per app lifecycle

---

## Quick Start

### Basic Usage (Auto-detect Platform)

```typescript
import { StorageFactory } from '@/repositories';

// Create storage instance (auto-detects platform)
const storage = await StorageFactory.create();

// Use like normal IRepository
const patient = await storage.create("patients", patientData);
```

### With Configuration

```typescript
import { StorageFactory, LogLevel } from '@/repositories';

const storage = await StorageFactory.create({
  databaseName: 'my_custom_db',
  enableLogging: true,
  logLevel: LogLevel.DEBUG,
  enablePerformanceMonitoring: true,
  slowQueryThreshold: 500, // Log queries > 500ms
});
```

### Using Convenience Function

```typescript
import { getStorage } from '@/repositories';

// Shorter alias for StorageFactory.create()
const storage = await getStorage({
  enableLogging: true,
});
```

---

## Platform Detection

### Automatic Detection

StorageFactory uses `Platform.OS` to select adapters:

| Platform      | Adapter Selected | Technology           |
|---------------|------------------|----------------------|
| Android       | SqliteAdapter    | expo-sqlite (WAL)    |
| iOS           | SqliteAdapter    | expo-sqlite (WAL)    |
| Web           | DexieAdapter     | Dexie.js (IndexedDB) |
| Unknown       | DexieAdapter     | Fallback             |

### Platform Capabilities Check

```typescript
import { PlatformDetector, StoragePlatform } from '@/repositories';

// Get platform info
const platform = PlatformDetector.getPlatform();
console.log(platform); // StoragePlatform.ANDROID

// Check specific capabilities
const canUseSQLite = PlatformDetector.canUseSQLite();
const canUseIndexedDB = PlatformDetector.canUseIndexedDB();

// Get detailed capabilities
const capabilities = PlatformDetector.detect();
console.log(capabilities);
/*
{
  platform: StoragePlatform.WEB,
  supportsIndexedDB: true,
  supportsSQLite: false,
  supportsWebSQL: false,
  isNative: false,
  isBrowser: true,
  browserName: "Chrome",
  browserVersion: "120",
  recommendedAdapter: AdapterType.INDEXEDDB
}
*/

// Pretty print platform info
console.log(PlatformDetector.getInfo());
/*
Platform: web
Browser: Chrome 120
IndexedDB: ✓
SQLite: ✗
Recommended Adapter: indexeddb
*/
```

### Force Specific Adapter

```typescript
import { StorageFactory, AdapterType } from '@/repositories';

// Force SQLite (even on web - will fail if not supported)
const storage = await StorageFactory.create({
  forceAdapter: AdapterType.SQLITE,
});

// Force IndexedDB (even on native - will fail if not supported)
const storage = await StorageFactory.create({
  forceAdapter: AdapterType.INDEXEDDB,
});
```

---

## Configuration Options

### Full Configuration Interface

```typescript
interface StorageConfig {
  // Database name
  databaseName?: string; // Default: "sofia"

  // Force specific adapter (overrides auto-detection)
  forceAdapter?: AdapterType;

  // Logging
  enableLogging?: boolean; // Default: false
  logLevel?: LogLevel; // Default: LogLevel.INFO

  // Performance monitoring
  enablePerformanceMonitoring?: boolean; // Default: false
  slowQueryThreshold?: number; // Default: 1000ms

  // Health checks
  enableHealthChecks?: boolean; // Default: true
  healthCheckInterval?: number; // Default: 300000ms (5 min)

  // Error handling
  enableFallback?: boolean; // Default: true
  maxRetries?: number; // Default: 3
  retryDelay?: number; // Default: 1000ms

  // Database options
  autoMigrate?: boolean; // Default: true
  enableWAL?: boolean; // Default: true (SQLite only)

  // Event handlers
  onError?: (error: Error, operation: string) => void;
  onSlowQuery?: (operation: string, duration: number, details: any) => void;
  onHealthCheckFailed?: (error: Error) => void;
}
```

### Common Configurations

#### Production Configuration

```typescript
const storage = await StorageFactory.create({
  databaseName: 'sofia_prod',
  enableLogging: false, // Disable logging in production
  enablePerformanceMonitoring: true,
  slowQueryThreshold: 2000, // Alert on queries > 2s
  enableHealthChecks: true,
  healthCheckInterval: 600000, // Check every 10 minutes
  maxRetries: 5,
  onError: (error, operation) => {
    // Send to error tracking service (e.g., Sentry)
    console.error(`[Production Error] ${operation}:`, error);
  },
  onSlowQuery: (operation, duration) => {
    // Send to analytics
    console.warn(`[Performance] ${operation} took ${duration}ms`);
  },
});
```

#### Development Configuration

```typescript
const storage = await StorageFactory.create({
  databaseName: 'sofia_dev',
  enableLogging: true,
  logLevel: LogLevel.DEBUG,
  enablePerformanceMonitoring: true,
  slowQueryThreshold: 500,
  enableHealthChecks: false, // Disable health checks in dev
  maxRetries: 1, // Fail fast in development
});
```

#### Testing Configuration

```typescript
const storage = await StorageFactory.create({
  databaseName: 'sofia_test',
  enableLogging: false,
  enableHealthChecks: false,
  enablePerformanceMonitoring: false,
  maxRetries: 0, // No retries in tests
});

// Reset after each test
afterEach(() => {
  StorageFactory.reset();
});
```

---

## Health Monitoring

### Automatic Health Checks

StorageFactory automatically performs health checks:

```typescript
const storage = await StorageFactory.create({
  enableHealthChecks: true,
  healthCheckInterval: 300000, // Every 5 minutes
  onHealthCheckFailed: (error) => {
    console.error('Storage health check failed!', error);
    // Alert admin, attempt recovery, etc.
  },
});
```

### Manual Health Check

```typescript
import { StorageFactory } from '@/repositories';

// Perform health check on demand
const isHealthy = await StorageFactory.performHealthCheck();

if (!isHealthy) {
  console.error('Storage is unhealthy!');
}
```

### Get Health Status

```typescript
import { StorageFactory } from '@/repositories';

const health = StorageFactory.getHealth();
console.log(health);
/*
{
  healthy: true,
  lastCheck: "2026-03-25T14:30:00.000Z",
  errorCount: 0,
  lastError: undefined
}
*/
```

---

## Performance Monitoring

### Enable Performance Tracking

```typescript
const storage = await StorageFactory.create({
  enablePerformanceMonitoring: true,
  slowQueryThreshold: 1000, // Warn on operations > 1s
  onSlowQuery: (operation, duration, details) => {
    console.warn(`SLOW: ${operation} took ${duration}ms`, details);
  },
});
```

### Get Performance Metrics

```typescript
import { StorageFactory } from '@/repositories';

const metrics = StorageFactory.getMetrics();
console.log(metrics);
/*
{
  totalOperations: 1523,
  totalDuration: 45678,
  averageDuration: 30,
  slowestOperation: {
    operation: "queryBySession:patients",
    duration: 2345,
    timestamp: "2026-03-25T14:30:00.000Z"
  }
}
*/
```

---

## Error Handling & Retry Logic

### Automatic Retries

Failed operations are automatically retried with exponential backoff:

```typescript
const storage = await StorageFactory.create({
  maxRetries: 3, // Try up to 3 times
  retryDelay: 1000, // Base delay 1s
  // Delays: 1s, 2s, 4s (exponential backoff)
  onError: (error, operation) => {
    console.error(`Operation ${operation} failed:`, error);
  },
});
```

### Custom Error Handling

```typescript
const storage = await StorageFactory.create({
  onError: (error, operation) => {
    // Custom error handling
    if (error.message.includes('FOREIGN KEY')) {
      console.error('Data integrity error:', operation);
    } else if (error.message.includes('quota')) {
      console.error('Storage quota exceeded:', operation);
      // Trigger cleanup
    }
  },
});
```

### Fallback Mechanisms

If initialization fails, StorageFactory can attempt fallback:

```typescript
const storage = await StorageFactory.create({
  enableFallback: true, // Default: true
  // If primary adapter fails, try alternatives
});
```

---

## Runtime Information

### Get Current Adapter Type

```typescript
import { StorageFactory, AdapterType } from '@/repositories';

await StorageFactory.create();

const adapterType = StorageFactory.getAdapterType();
console.log(adapterType); // AdapterType.SQLITE or AdapterType.INDEXEDDB
```

### Get Platform Capabilities

```typescript
import { StorageFactory } from '@/repositories';

await StorageFactory.create();

const capabilities = StorageFactory.getCapabilities();
console.log(capabilities);
/*
{
  platform: "android",
  supportsIndexedDB: false,
  supportsSQLite: true,
  supportsWebSQL: false,
  isNative: true,
  isBrowser: false,
  recommendedAdapter: "sqlite"
}
*/
```

### Get Current Configuration

```typescript
import { StorageFactory } from '@/repositories';

const config = StorageFactory.getConfig();
console.log(config);
// Returns merged config (user config + defaults)
```

---

## Lifecycle Management

### Initialization

```typescript
// Create and initialize
const storage = await StorageFactory.create();

// Check if initialized
const initialized = StorageFactory.isInitialized();
console.log(initialized); // true

// Get instance (returns null if not initialized)
const instance = StorageFactory.getInstance();
```

### Cleanup

```typescript
// Destroy current instance (closes connections, stops health checks)
await StorageFactory.destroy();

// Reset factory state (for testing)
StorageFactory.reset();
```

---

## Advanced Usage

### Platform-Specific Database Names

```typescript
import { PlatformDetector, StorageFactory } from '@/repositories';

const platform = PlatformDetector.getPlatform();

const dbName = platform === 'web'
  ? 'sofia_web_db'
  : 'sofia_mobile_db';

const storage = await StorageFactory.create({
  databaseName: dbName,
});
```

### Conditional Features by Platform

```typescript
import { PlatformDetector, StorageFactory } from '@/repositories';

const isNative = PlatformDetector.isNative();

const storage = await StorageFactory.create({
  enableWAL: isNative, // Only enable WAL on native platforms
  slowQueryThreshold: isNative ? 500 : 2000, // Stricter on native
});
```

### Custom Logging Integration

```typescript
import { StorageFactory, LogLevel } from '@/repositories';

// Integrate with custom logger (e.g., Winston, Bunyan)
const storage = await StorageFactory.create({
  enableLogging: true,
  logLevel: LogLevel.DEBUG,
  onError: (error, operation) => {
    myLogger.error({ operation, error: error.message });
  },
  onSlowQuery: (operation, duration) => {
    myLogger.warn({ operation, duration, type: 'slow_query' });
  },
});
```

---

## Migration from RepositoryFactory

### Old Way (RepositoryFactory)

```typescript
import { RepositoryFactory } from '@/repositories';

const repo = await RepositoryFactory.create();
```

### New Way (StorageFactory)

```typescript
import { StorageFactory } from '@/repositories';

const repo = await StorageFactory.create();
```

**Note:** `RepositoryFactory` still works and is **backward compatible**. `StorageFactory` provides additional features.

### Using Both

```typescript
// RepositoryFactory: Simple, no config
import { getRepository } from '@/repositories';
const repo = await getRepository();

// StorageFactory: Advanced, configurable
import { getStorage } from '@/repositories';
const storage = await getStorage({ enableLogging: true });
```

---

## Platform-Specific Examples

### Android/iOS Example

```typescript
import { StorageFactory, PlatformDetector } from '@/repositories';

if (PlatformDetector.isNative()) {
  const storage = await StorageFactory.create({
    databaseName: 'sofia_mobile',
    enableWAL: true, // SQLite WAL mode
    enableLogging: __DEV__, // Only in development
  });

  // Now using SQLite with WAL mode
  const patient = await storage.create("patients", patientData);
}
```

### Web Example

```typescript
import { StorageFactory, PlatformDetector } from '@/repositories';

if (PlatformDetector.isBrowser()) {
  const storage = await StorageFactory.create({
    databaseName: 'sofia_web',
    enableHealthChecks: true,
    healthCheckInterval: 600000, // 10 minutes
  });

  // Now using IndexedDB via Dexie
  const patient = await storage.create("patients", patientData);
}
```

---

## Debugging

### Enable Debug Logging

```typescript
import { StorageFactory, LogLevel } from '@/repositories';

const storage = await StorageFactory.create({
  enableLogging: true,
  logLevel: LogLevel.DEBUG,
  enablePerformanceMonitoring: true,
});

// Console output:
// [StorageFactory:INFO] Platform detected: android
// [StorageFactory:INFO] Using recommended adapter: sqlite
// [StorageFactory:DEBUG] Creating SqliteAdapter with database: sofia.db
// [StorageFactory:INFO] Adapter initialized in 234ms
```

### Inspect Platform Detection

```typescript
import { PlatformDetector } from '@/repositories';

console.log(PlatformDetector.getInfo());
/*
Platform: android
IndexedDB: ✗
SQLite: ✓
Recommended Adapter: sqlite
*/
```

### Monitor Health and Performance

```typescript
import { StorageFactory } from '@/repositories';

// Set up monitoring interval
setInterval(() => {
  const health = StorageFactory.getHealth();
  const metrics = StorageFactory.getMetrics();

  console.log('Health:', health.healthy ? '✓' : '✗');
  console.log('Avg Operation Time:', metrics.averageDuration, 'ms');
  console.log('Total Operations:', metrics.totalOperations);
}, 60000); // Every minute
```

---

## Comparison: RepositoryFactory vs StorageFactory

| Feature                    | RepositoryFactory | StorageFactory |
|----------------------------|-------------------|----------------|
| Platform auto-detection    | ✓                 | ✓              |
| Basic configuration        | ✗                 | ✓              |
| Health monitoring          | ✗                 | ✓              |
| Performance tracking       | ✗                 | ✓              |
| Retry logic                | ✗                 | ✓              |
| Fallback mechanisms        | ✗                 | ✓              |
| Custom error handlers      | ✗                 | ✓              |
| Logging control            | Basic             | Advanced       |
| Platform capabilities info | ✗                 | ✓              |
| Metrics collection         | ✗                 | ✓              |

**Recommendation:** Use `StorageFactory` for production apps, `RepositoryFactory` for simple projects.

---

## Best Practices

### 1. Initialize Once at App Start

```typescript
// App.tsx
import { StorageFactory } from '@/repositories';

export default function App() {
  useEffect(() => {
    async function initStorage() {
      await StorageFactory.create({
        enableLogging: __DEV__,
        enablePerformanceMonitoring: true,
      });
    }
    initStorage();
  }, []);

  return <AppNavigator />;
}
```

### 2. Use Environment-Specific Config

```typescript
const isProd = process.env.NODE_ENV === 'production';

const storage = await StorageFactory.create({
  databaseName: isProd ? 'sofia_prod' : 'sofia_dev',
  enableLogging: !isProd,
  logLevel: isProd ? LogLevel.ERROR : LogLevel.DEBUG,
  slowQueryThreshold: isProd ? 2000 : 500,
});
```

### 3. Graceful Degradation

```typescript
try {
  const storage = await StorageFactory.create({
    enableFallback: true,
  });
} catch (error) {
  console.error('Storage initialization failed:', error);
  // Show user-friendly error message
  Alert.alert('Storage Error', 'Unable to initialize local storage');
}
```

### 4. Monitor Production Health

```typescript
const storage = await StorageFactory.create({
  enableHealthChecks: true,
  onHealthCheckFailed: (error) => {
    // Send alert to monitoring service
    Sentry.captureException(error, {
      tags: { component: 'storage', type: 'health_check' },
    });
  },
});
```

---

## Troubleshooting

### Issue: "SQLite not supported on this platform"

**Solution:** Platform detection failed or using forced adapter incorrectly.

```typescript
import { PlatformDetector } from '@/repositories';

// Check platform capabilities
const canUseSQLite = PlatformDetector.canUseSQLite();
console.log('SQLite support:', canUseSQLite);

// Don't force adapter on unsupported platforms
const storage = await StorageFactory.create({
  // forceAdapter: AdapterType.SQLITE, // ❌ Remove this
});
```

### Issue: Health checks failing repeatedly

**Solution:** Increase interval or disable health checks.

```typescript
const storage = await StorageFactory.create({
  enableHealthChecks: true,
  healthCheckInterval: 600000, // Increase to 10 minutes
  onHealthCheckFailed: (error) => {
    console.error('Health check failed:', error);
    // Investigate root cause
  },
});
```

### Issue: Slow query warnings

**Solution:** Adjust threshold or optimize queries.

```typescript
const storage = await StorageFactory.create({
  slowQueryThreshold: 2000, // Increase threshold
  onSlowQuery: (operation, duration) => {
    // Log for investigation
    console.warn(`${operation} took ${duration}ms - consider optimization`);
  },
});
```

---

## API Reference

See individual files for detailed API documentation:
- `StorageFactory.ts` - Main factory class
- `PlatformDetector.ts` - Platform detection utilities
- `StorageConfig.ts` - Configuration types and defaults
- `MonitoredAdapter.ts` - Performance monitoring wrapper
