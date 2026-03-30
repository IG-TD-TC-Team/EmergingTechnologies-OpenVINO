/**
 * Dexie Adapter Integration Tests
 *
 * Tests the Dexie (IndexedDB) adapter for Web platform
 * using the simplified integration test suite.
 */

import { DexieAdapter } from '../../repositories/adapters/dexie/DexieAdapter';
import { runStorageIntegrationTests } from './shared/storage.integration.suite.simple';

describe('DexieAdapter Integration Tests', () => {
  runStorageIntegrationTests(() => {
    // Create a new DexieAdapter instance with unique database name per test
    const dbName = `sofia_test_${Date.now()}_${Math.random()}`;
    const adapter = new DexieAdapter(dbName);
    return adapter;
  });

  describe('Dexie-specific features', () => {
    let adapter: DexieAdapter;

    beforeEach(async () => {
      const dbName = `sofia_dexie_specific_${Date.now()}_${Math.random()}`;
      adapter = new DexieAdapter(dbName);
    });

    it('should use IndexedDB', () => {
      expect(global.indexedDB).toBeDefined();
    });

    it('should create DexieAdapter instance', () => {
      expect(adapter).toBeDefined();
      expect(adapter.create).toBeDefined();
      expect(adapter.read).toBeDefined();
      expect(adapter.purgeExpired).toBeDefined();
    });
  });
});
