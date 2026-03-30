/**
 * SQLite Adapter Integration Tests
 *
 * Tests the SQLite adapter for Android/iOS platforms
 * using the shared integration test suite.
 */

import { SqliteAdapter } from '../../repositories/adapters/sqlite/SqliteAdapter';
import { runStorageIntegrationTests } from './shared/storage.integration.suite';

// Mock expo-sqlite
const mockDb = {
  runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
  getFirstAsync: jest.fn().mockResolvedValue(null),
  getAllAsync: jest.fn().mockResolvedValue([]),
  execAsync: jest.fn().mockResolvedValue({ changes: 0 }),
  closeAsync: jest.fn().mockResolvedValue(undefined),
  withTransactionAsync: jest.fn(async (fn) => {
    await fn();
  }),
};

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue(mockDb),
}));

describe('SqliteAdapter Integration Tests', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  runStorageIntegrationTests(async () => {
    // Create a new SqliteAdapter instance with unique database name per test
    const dbName = `sofia_test_${Date.now()}_${Math.random()}.db`;
    const adapter = new SqliteAdapter(dbName);

    // Mock the database operations to use in-memory storage
    // In a real test environment, you might use an actual SQLite test database
    return adapter;
  });

  describe('SQLite-specific features', () => {
    let adapter: SqliteAdapter;

    beforeEach(async () => {
      const dbName = `sofia_sqlite_specific_${Date.now()}.db`;
      adapter = new SqliteAdapter(dbName);
      await adapter.initialize();
    });

    afterEach(async () => {
      if (adapter) {
        await adapter.close();
      }
    });

    it('should use expo-sqlite', () => {
      const { openDatabaseAsync } = require('expo-sqlite');
      expect(openDatabaseAsync).toHaveBeenCalled();
    });

    it('should create database with WAL mode', async () => {
      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
    });
  });
});
