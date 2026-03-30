/**
 * Dexie Adapter Integration Tests
 *
 * Tests the Dexie (IndexedDB) adapter for Web platform
 * using the shared integration test suite.
 */

import { DexieAdapter } from '../../repositories/adapters/dexie/DexieAdapter';
import { runStorageIntegrationTests } from './shared/storage.integration.suite';

describe('DexieAdapter Integration Tests', () => {
  runStorageIntegrationTests(() => {
    // Create a new DexieAdapter instance with unique database name per test
    const dbName = `sofia_test_${Date.now()}_${Math.random()}`;
    return new DexieAdapter(dbName);
  });

  describe('Dexie-specific features', () => {
    let adapter: DexieAdapter;

    beforeEach(async () => {
      const dbName = `sofia_dexie_specific_${Date.now()}_${Math.random()}`;
      adapter = new DexieAdapter(dbName);
      await adapter.initialize();
    });

    afterEach(async () => {
      if (adapter) {
        await adapter.close();
      }
    });

    it('should use IndexedDB', async () => {
      expect(global.indexedDB).toBeDefined();
    });

    it('should create database with correct schema', async () => {
      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
    });
  });
});
