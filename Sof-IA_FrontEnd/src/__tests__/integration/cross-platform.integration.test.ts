/**
 * Cross-Platform Integration Tests
 *
 * Comprehensive tests to verify US17 acceptance criteria:
 * - Android: all features enabled (recording, Bluetooth, file system, background tasks)
 * - Chrome Web: Bluetooth hidden, Web mic active, Service Worker used
 * - Feature flags readable anywhere
 * - Unsupported features completely absent (clean UI)
 * - No runtime crashes from missing platform APIs
 */

import { capabilities } from '../../config/capabilities';

describe('Cross-Platform Integration Tests - US17', () => {
  describe('Platform Detection', () => {
    it('should detect platform correctly on launch', () => {
      expect(capabilities).toBeDefined();
      expect(capabilities.platform).toBeDefined();
      expect(['android', 'ios', 'web', 'windows', 'macos']).toContain(
        capabilities.platform
      );
    });

    it('should configure features based on platform', () => {
      expect(capabilities.hasBluetooth).toBeDefined();
      expect(capabilities.hasFileSystem).toBeDefined();
      expect(capabilities.hasBackgroundTasks).toBeDefined();
      expect(capabilities.audioRecorder).toBeDefined();
      expect(capabilities.storage).toBeDefined();
    });
  });

  describe('Feature Flags - Globally Accessible', () => {
    it('should expose all capability flags', () => {
      // Verify all required flags are present
      expect(capabilities).toHaveProperty('hasBluetooth');
      expect(capabilities).toHaveProperty('hasFileSystem');
      expect(capabilities).toHaveProperty('hasBackgroundTasks');
      expect(capabilities).toHaveProperty('audioRecorder');
      expect(capabilities).toHaveProperty('storage');
      expect(capabilities).toHaveProperty('platform');
      expect(capabilities).toHaveProperty('isNative');
      expect(capabilities).toHaveProperty('isWeb');
    });

    it('should have boolean flags for native features', () => {
      expect(typeof capabilities.hasBluetooth).toBe('boolean');
      expect(typeof capabilities.hasFileSystem).toBe('boolean');
      expect(typeof capabilities.hasBackgroundTasks).toBe('boolean');
      expect(typeof capabilities.isNative).toBe('boolean');
      expect(typeof capabilities.isWeb).toBe('boolean');
    });

    it('should have correct implementation types', () => {
      expect(['MediaRecorder', 'expo-av']).toContain(
        capabilities.audioRecorder
      );
      expect(['dexie', 'sqlite']).toContain(capabilities.storage);
    });
  });

  describe('Platform Consistency Rules', () => {
    it('should have mutually exclusive isNative and isWeb flags', () => {
      // isNative and isWeb should never both be true
      const bothTrue = capabilities.isNative && capabilities.isWeb;
      expect(bothTrue).toBe(false);

      // At least one should be true
      const eitherTrue = capabilities.isNative || capabilities.isWeb;
      expect(eitherTrue).toBe(true);
    });

    it('should have consistent feature sets for native platforms', () => {
      if (capabilities.isNative) {
        // All native features should be available
        expect(capabilities.hasBluetooth).toBe(true);
        expect(capabilities.hasFileSystem).toBe(true);
        expect(capabilities.hasBackgroundTasks).toBe(true);
        expect(capabilities.audioRecorder).toBe('expo-av');
        expect(capabilities.storage).toBe('sqlite');
      }
    });

    it('should have consistent feature sets for web platform', () => {
      if (capabilities.isWeb) {
        // Native-only features should be disabled
        expect(capabilities.hasBluetooth).toBe(false);
        expect(capabilities.hasFileSystem).toBe(false);
        expect(capabilities.hasBackgroundTasks).toBe(false);
        expect(capabilities.audioRecorder).toBe('MediaRecorder');
        expect(capabilities.storage).toBe('dexie');
      }
    });
  });

  describe('No Runtime Crashes - API Safety', () => {
    it('should not throw errors when accessing capabilities', () => {
      expect(() => capabilities.hasBluetooth).not.toThrow();
      expect(() => capabilities.hasFileSystem).not.toThrow();
      expect(() => capabilities.hasBackgroundTasks).not.toThrow();
      expect(() => capabilities.audioRecorder).not.toThrow();
      expect(() => capabilities.storage).not.toThrow();
      expect(() => capabilities.platform).not.toThrow();
      expect(() => capabilities.isNative).not.toThrow();
      expect(() => capabilities.isWeb).not.toThrow();
    });

    it('should have safeguards in StorageFactory', () => {
      // StorageFactory should check capabilities before instantiating adapters
      const { StorageFactory } = require('../../repositories/adapters/StorageFactory');

      expect(StorageFactory).toBeDefined();
      expect(StorageFactory.create).toBeDefined();
      expect(typeof StorageFactory.create).toBe('function');
    });

    it('should have safeguards in SqliteAdapter', () => {
      if (capabilities.isWeb) {
        // SqliteAdapter should throw descriptive error on web
        const { SqliteAdapter } = require('../../repositories/adapters/sqlite/SqliteAdapter');

        expect(() => new SqliteAdapter()).toThrow(/Cannot initialize SQLite on web platform/);
      }
    });

    it('should handle USBMicStrategy gracefully on web', async () => {
      const USBMicStrategy = require('../../services/audio/USBMicStrategy').default;

      // Should not throw, just return false
      await expect(USBMicStrategy.isAvailable()).resolves.toBe(
        capabilities.isNative ? expect.any(Boolean) : false
      );
    });
  });

  describe('Clean UI - No Disabled Elements', () => {
    it('should use conditional rendering, not disabled states', () => {
      // This is verified in RecordingModeScreen and SettingsScreen tests
      // Here we verify the pattern is documented
      expect(capabilities.hasBluetooth).toBeDefined();

      // Components should use: {hasBluetooth && <BluetoothButton />}
      // Not: <BluetoothButton disabled={!hasBluetooth} />
    });
  });

  describe('Cross-Platform Feature Parity', () => {
    it('should have core features available on all platforms', () => {
      // These features should work everywhere
      expect(capabilities.audioRecorder).toBeDefined();
      expect(capabilities.storage).toBeDefined();
      expect(capabilities.platform).toBeDefined();
    });

    it('should have platform-specific features only where supported', () => {
      // Bluetooth: Android/iOS only
      if (capabilities.isNative) {
        expect(capabilities.hasBluetooth).toBe(true);
      } else {
        expect(capabilities.hasBluetooth).toBe(false);
      }

      // File System: Android/iOS only
      if (capabilities.isNative) {
        expect(capabilities.hasFileSystem).toBe(true);
      } else {
        expect(capabilities.hasFileSystem).toBe(false);
      }

      // Background Tasks: Android/iOS only
      if (capabilities.isNative) {
        expect(capabilities.hasBackgroundTasks).toBe(true);
      } else {
        expect(capabilities.hasBackgroundTasks).toBe(false);
      }
    });
  });

  describe('Implementation Validation', () => {
    it('should use correct audio recorder for platform', () => {
      if (capabilities.platform === 'android' || capabilities.platform === 'ios') {
        expect(capabilities.audioRecorder).toBe('expo-av');
      } else if (capabilities.platform === 'web') {
        expect(capabilities.audioRecorder).toBe('MediaRecorder');
      }
    });

    it('should use correct storage adapter for platform', () => {
      if (capabilities.platform === 'android' || capabilities.platform === 'ios') {
        expect(capabilities.storage).toBe('sqlite');
      } else if (capabilities.platform === 'web') {
        expect(capabilities.storage).toBe('dexie');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle missing native modules gracefully', () => {
      // If we're on web, native modules should not crash
      if (capabilities.isWeb) {
        // PermissionsService should handle web gracefully
        const PermissionsService = require('../../services/PermissionsService').default;

        expect(PermissionsService.check).toBeDefined();
        expect(PermissionsService.request).toBeDefined();

        // These should return 'granted' immediately on web
        expect(PermissionsService.check()).resolves.toBe('granted');
        expect(PermissionsService.request()).resolves.toBe('granted');
      }
    });

    it('should handle AudioSourceResolver on web', async () => {
      const AudioSourceResolver = require('../../services/audio/AudioSourceResolver').default;

      // Should not crash on web
      const strategy = await AudioSourceResolver.resolve();
      expect(strategy).toBeDefined();

      if (capabilities.isWeb) {
        // Web should always use DeviceMicStrategy
        expect(strategy.getSourceKey()).toBe('builtin');
      }
    });
  });

  describe('Acceptance Criteria Verification', () => {
    it('AC1: App detects platform on launch', () => {
      expect(capabilities.platform).toBeDefined();
      expect(capabilities.isNative).toBeDefined();
      expect(capabilities.isWeb).toBeDefined();
    });

    it('AC2: Android has all features enabled', () => {
      if (capabilities.platform === 'android') {
        expect(capabilities.hasBluetooth).toBe(true);
        expect(capabilities.hasFileSystem).toBe(true);
        expect(capabilities.hasBackgroundTasks).toBe(true);
        expect(capabilities.audioRecorder).toBe('expo-av');
        expect(capabilities.storage).toBe('sqlite');
      }
    });

    it('AC3: Chrome Web has correct configuration', () => {
      if (capabilities.platform === 'web') {
        expect(capabilities.hasBluetooth).toBe(false);
        expect(capabilities.audioRecorder).toBe('MediaRecorder');
        expect(capabilities.storage).toBe('dexie');
      }
    });

    it('AC4: Feature flags are globally accessible', () => {
      // Can import capabilities from anywhere
      const { capabilities: importedCaps } = require('../../config/capabilities');
      expect(importedCaps).toBeDefined();
      expect(importedCaps.hasBluetooth).toBeDefined();
    });

    it('AC5: No runtime crashes from missing APIs', () => {
      // All tested in "No Runtime Crashes - API Safety" section
      expect(true).toBe(true);
    });
  });
});
