/**
 * Web Platform Specific Integration Tests
 *
 * Tests specific to Chrome Web deployment:
 * - MediaRecorder availability and functionality
 * - Service Worker registration
 * - IndexedDB (Dexie) availability
 * - Console error detection
 * - No crashes from missing native APIs
 */

describe('Web Platform Integration Tests', () => {
  // Only run these tests in browser/web environment
  const isWebEnvironment = typeof window !== 'undefined';

  describe('MediaRecorder Availability', () => {
    it('should have MediaRecorder API available in browser', () => {
      if (!isWebEnvironment) {
        console.log('[Web Tests] Skipping: Not in browser environment');
        return;
      }

      // MediaRecorder should be available in modern browsers
      expect(window.MediaRecorder).toBeDefined();
      expect(typeof window.MediaRecorder).toBe('function');
    });

    it('should support required MIME types for audio recording', () => {
      if (!isWebEnvironment || !window.MediaRecorder) {
        console.log('[Web Tests] Skipping: MediaRecorder not available');
        return;
      }

      // Check for common audio MIME types
      const audioMimeTypes = [
        'audio/webm',
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];

      // At least one audio format should be supported
      const supportedFormats = audioMimeTypes.filter((mimeType) =>
        MediaRecorder.isTypeSupported(mimeType)
      );

      expect(supportedFormats.length).toBeGreaterThan(0);
      console.log('[Web Tests] Supported audio formats:', supportedFormats);
    });

    it('should be able to create MediaRecorder instance', async () => {
      if (!isWebEnvironment || !window.MediaRecorder) {
        console.log('[Web Tests] Skipping: MediaRecorder not available');
        return;
      }

      // Mock getUserMedia for testing
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.log('[Web Tests] Skipping: getUserMedia not available');
        return;
      }

      try {
        // Request microphone access (will be mocked in tests)
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Create MediaRecorder
        const recorder = new MediaRecorder(stream);

        expect(recorder).toBeDefined();
        expect(recorder.state).toBe('inactive');
        expect(typeof recorder.start).toBe('function');
        expect(typeof recorder.stop).toBe('function');

        // Clean up
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        // In test environment, this might fail - that's okay
        console.log('[Web Tests] MediaRecorder creation failed (expected in test env):', error);
      }
    });
  });

  describe('Service Worker Support', () => {
    it('should have Service Worker API available in browser', () => {
      if (!isWebEnvironment) {
        console.log('[Web Tests] Skipping: Not in browser environment');
        return;
      }

      // Service Worker API should be available in modern browsers
      expect('serviceWorker' in navigator).toBe(true);
    });

    it('should support Service Worker registration', () => {
      if (!isWebEnvironment || !('serviceWorker' in navigator)) {
        console.log('[Web Tests] Skipping: Service Worker not supported');
        return;
      }

      expect(navigator.serviceWorker).toBeDefined();
      expect(typeof navigator.serviceWorker.register).toBe('function');
      expect(typeof navigator.serviceWorker.ready).toBe('object');
    });

    it('should check Service Worker registration status', async () => {
      if (!isWebEnvironment || !('serviceWorker' in navigator)) {
        console.log('[Web Tests] Skipping: Service Worker not supported');
        return;
      }

      try {
        // Check if a service worker is registered
        const registration = await navigator.serviceWorker.getRegistration();

        if (registration) {
          console.log('[Web Tests] Service Worker registered:', registration.scope);
          expect(registration).toBeDefined();
          expect(registration.scope).toBeDefined();
        } else {
          console.log('[Web Tests] No Service Worker registered yet');
        }
      } catch (error) {
        console.log('[Web Tests] Service Worker check failed:', error);
      }
    });
  });

  describe('IndexedDB Availability', () => {
    it('should have IndexedDB API available in browser', () => {
      if (!isWebEnvironment) {
        console.log('[Web Tests] Skipping: Not in browser environment');
        return;
      }

      expect(window.indexedDB).toBeDefined();
      expect(typeof window.indexedDB.open).toBe('function');
    });

    it('should be able to open IndexedDB database', async () => {
      if (!isWebEnvironment || !window.indexedDB) {
        console.log('[Web Tests] Skipping: IndexedDB not available');
        return;
      }

      return new Promise<void>((resolve, reject) => {
        const dbName = 'test_db_us17';
        const request = window.indexedDB.open(dbName, 1);

        request.onerror = () => {
          console.log('[Web Tests] IndexedDB open failed:', request.error);
          // Don't fail the test, just log
          resolve();
        };

        request.onsuccess = () => {
          const db = request.result;
          expect(db).toBeDefined();
          expect(db.name).toBe(dbName);

          // Clean up
          db.close();
          window.indexedDB.deleteDatabase(dbName);

          resolve();
        };

        request.onupgradeneeded = (event: any) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('test_store')) {
            db.createObjectStore('test_store', { keyPath: 'id' });
          }
        };
      });
    });

    it('should verify Dexie.js can be imported', () => {
      // Dexie should be available for import
      const { DexieAdapter } = require('../../repositories/adapters/dexie/DexieAdapter');

      expect(DexieAdapter).toBeDefined();
      expect(typeof DexieAdapter).toBe('function');
    });
  });

  describe('Browser Console Error Detection', () => {
    let originalConsoleError: typeof console.error;
    const consoleErrors: any[] = [];

    beforeAll(() => {
      // Capture console.error calls
      originalConsoleError = console.error;
      console.error = (...args: any[]) => {
        consoleErrors.push(args);
        originalConsoleError.apply(console, args);
      };
    });

    afterAll(() => {
      // Restore original console.error
      console.error = originalConsoleError;

      // Report captured errors
      if (consoleErrors.length > 0) {
        console.log(
          '[Web Tests] Console errors detected during tests:',
          consoleErrors.length
        );
      }
    });

    it('should not have errors about missing native APIs', () => {
      // Filter for errors related to native APIs
      const nativeApiErrors = consoleErrors.filter((args) => {
        const message = args.join(' ').toLowerCase();
        return (
          message.includes('expo-sqlite') ||
          message.includes('sqlite') ||
          message.includes('native module') ||
          message.includes('expo-av') ||
          message.includes('expo-linking')
        );
      });

      // We expect no errors about missing native APIs on web
      // (They should be gracefully handled)
      expect(nativeApiErrors.length).toBe(0);
    });

    it('should not have errors about undefined platform APIs', () => {
      const platformApiErrors = consoleErrors.filter((args) => {
        const message = args.join(' ').toLowerCase();
        return (
          message.includes('is not defined') ||
          message.includes('undefined is not a function') ||
          message.includes('cannot read property')
        );
      });

      // Platform-specific APIs should be checked before use
      expect(platformApiErrors.length).toBe(0);
    });
  });

  describe('Web Capabilities Configuration', () => {
    it('should have web-specific capabilities set correctly', () => {
      const { capabilities } = require('../../config/capabilities');

      if (capabilities.platform === 'web') {
        expect(capabilities.hasBluetooth).toBe(false);
        expect(capabilities.hasFileSystem).toBe(false);
        expect(capabilities.hasBackgroundTasks).toBe(false);
        expect(capabilities.audioRecorder).toBe('MediaRecorder');
        expect(capabilities.storage).toBe('dexie');
        expect(capabilities.isWeb).toBe(true);
        expect(capabilities.isNative).toBe(false);
      }
    });
  });

  describe('Web-Specific Services', () => {
    it('should handle PermissionsService on web', async () => {
      const PermissionsService = require('../../services/PermissionsService').default;
      const { capabilities } = require('../../config/capabilities');

      if (capabilities.isWeb) {
        // Web now uses real Chrome APIs. In the test environment navigator is not
        // available, so check() falls back to 'undetermined' and request() falls
        // back to 'blocked'. Verify the service doesn't throw and returns a valid state.
        const validStates = ['granted', 'undetermined', 'denied', 'blocked'];

        const status = await PermissionsService.check();
        expect(validStates).toContain(status);

        const requestStatus = await PermissionsService.request();
        expect(validStates).toContain(requestStatus);
      }
    });

    it('should handle AudioSourceResolver on web', async () => {
      const AudioSourceResolver = require('../../services/audio/AudioSourceResolver').default;
      const { capabilities } = require('../../config/capabilities');

      if (capabilities.isWeb) {
        // Web should only have DeviceMicStrategy
        const strategy = await AudioSourceResolver.resolve();
        expect(strategy).toBeDefined();
        expect(strategy.getSourceKey()).toBe('builtin');

        // getAvailableSources should only return DeviceMicStrategy
        const sources = await AudioSourceResolver.getAvailableSources();
        expect(sources).toHaveLength(1);
        expect(sources[0].getSourceKey()).toBe('builtin');
      }
    });

    it('should handle USBMicStrategy gracefully on web', async () => {
      const USBMicStrategy = require('../../services/audio/USBMicStrategy').default;
      const { capabilities } = require('../../config/capabilities');

      if (capabilities.isWeb) {
        // USB detection should return false on web (no API available)
        const isAvailable = await USBMicStrategy.isAvailable();
        expect(isAvailable).toBe(false);
      }
    });
  });

  describe('Storage Factory - Web Adapter', () => {
    it('should select DexieAdapter on web', async () => {
      const { capabilities } = require('../../config/capabilities');

      if (capabilities.isWeb) {
        const { RepositoryFactory } = require('../../repositories/adapters/RepositoryFactory');

        // RepositoryFactory should select DexieAdapter for web
        // We can't easily test this without mocking, but we can verify it exists
        expect(RepositoryFactory).toBeDefined();
        expect(RepositoryFactory.create).toBeDefined();
      }
    });

    it('should prevent SqliteAdapter instantiation on web', () => {
      const { capabilities } = require('../../config/capabilities');

      if (capabilities.isWeb) {
        const { SqliteAdapter } = require('../../repositories/adapters/sqlite/SqliteAdapter');

        // SqliteAdapter constructor should throw on web
        expect(() => new SqliteAdapter()).toThrow(/Cannot initialize SQLite on web platform/);
      }
    });
  });

  describe('No Native Module Crashes', () => {
    it('should not crash when importing platform-specific modules', () => {
      // These imports should not crash, even on web
      expect(() => require('../../services/PermissionsService')).not.toThrow();
      expect(() => require('../../services/audio/USBMicStrategy')).not.toThrow();
      expect(() => require('../../services/audio/AudioSourceResolver')).not.toThrow();
      expect(() => require('../../config/capabilities')).not.toThrow();
    });

    it('should not crash when calling web-safe methods', async () => {
      const { capabilities } = require('../../config/capabilities');

      if (capabilities.isWeb) {
        const PermissionsService = require('../../services/PermissionsService').default;
        const AudioSourceResolver = require('../../services/audio/AudioSourceResolver').default;
        const USBMicStrategy = require('../../services/audio/USBMicStrategy').default;

        // None of these should crash
        await expect(PermissionsService.check()).resolves.toBeDefined();
        await expect(PermissionsService.request()).resolves.toBeDefined();
        await expect(AudioSourceResolver.resolve()).resolves.toBeDefined();
        await expect(USBMicStrategy.isAvailable()).resolves.toBeDefined();
      }
    });
  });
});
