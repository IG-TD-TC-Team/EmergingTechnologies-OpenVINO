/**
 * StorageFactory Integration Tests
 *
 * Tests the StorageFactory platform detection and adapter creation
 */

import { StorageFactory, StoragePlatform } from '../../repositories/adapters/StorageFactory';
import { PlatformDetector } from '../../repositories/adapters/PlatformDetector';
import { LogLevel } from '../../repositories/adapters/StorageConfig';

describe('StorageFactory Integration Tests', () => {
  afterEach(async () => {
    // Reset singleton instance
    await StorageFactory.reset();
  });

  describe('Platform Detection', () => {
    it('should detect platform capabilities', () => {
      const capabilities = PlatformDetector.detect();

      expect(capabilities).toHaveProperty('platform');
      expect(capabilities).toHaveProperty('supportsIndexedDB');
      expect(capabilities).toHaveProperty('recommendedAdapter');
    });

    it('should return singleton instance', async () => {
      const storage1 = await StorageFactory.create();
      const storage2 = await StorageFactory.create();

      expect(storage1).toBe(storage2);
    });

    it('should create new instance after reset', async () => {
      const storage1 = await StorageFactory.create();
      await StorageFactory.reset();
      const storage2 = await StorageFactory.create();

      expect(storage1).not.toBe(storage2);
    });
  });

  describe('Configuration', () => {
    it('should accept custom configuration', async () => {
      const storage = await StorageFactory.create({
        databaseName: 'custom_db',
        enableLogging: true,
        logLevel: LogLevel.DEBUG,
      });

      expect(storage).toBeDefined();
    });

    it('should use default configuration when not provided', async () => {
      const storage = await StorageFactory.create();

      expect(storage).toBeDefined();
      const health = await storage.healthCheck();
      expect(health.healthy).toBe(true);
    });
  });

  describe('Health Checks', () => {
    it('should perform health check on created storage', async () => {
      const storage = await StorageFactory.create({
        enableHealthChecks: true,
      });

      const health = await storage.healthCheck();

      expect(health).toHaveProperty('healthy');
      expect(health.healthy).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid configuration gracefully', async () => {
      const storage = await StorageFactory.create({
        databaseName: '', // Invalid empty name
      });

      // Should still create with fallback to default
      expect(storage).toBeDefined();
    });
  });

  describe('getStorage Helper', () => {
    it('should get existing storage instance', async () => {
      await StorageFactory.create();
      const storage = StorageFactory.getStorage();

      expect(storage).toBeDefined();
    });

    it('should throw error when accessing before creation', () => {
      expect(() => StorageFactory.getStorage()).toThrow();
    });
  });

  describe('Adapter Selection', () => {
    it('should select appropriate adapter based on platform', async () => {
      const storage = await StorageFactory.create();

      expect(storage).toBeDefined();
      expect(storage.initialize).toBeDefined();
      expect(storage.purgeExpired).toBeDefined();
    });
  });
});
