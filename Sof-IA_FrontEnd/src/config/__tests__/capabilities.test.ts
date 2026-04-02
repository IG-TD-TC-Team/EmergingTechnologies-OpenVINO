/**
 * Tests for Platform Capabilities Configuration
 */

// Note: We need to mock Platform before importing anything
let mockPlatformOS = 'android';

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
}));

describe('Platform Capabilities', () => {
  beforeEach(() => {
    // Clear module cache to get fresh capabilities for each test
    jest.resetModules();
  });

  describe('Android Platform', () => {
    beforeEach(() => {
      mockPlatformOS = 'android';
    });

    it('should enable all native features on Android', () => {
      const { capabilities } = require('../capabilities');

      expect(capabilities.hasBluetooth).toBe(true);
      expect(capabilities.hasFileSystem).toBe(true);
      expect(capabilities.hasBackgroundTasks).toBe(true);
      expect(capabilities.audioRecorder).toBe('expo-av');
      expect(capabilities.storage).toBe('sqlite');
      expect(capabilities.platform).toBe('android');
      expect(capabilities.isNative).toBe(true);
      expect(capabilities.isWeb).toBe(false);
    });

    it('should return correct platform name for Android', () => {
      const { getPlatformName } = require('../capabilities');
      expect(getPlatformName()).toBe('Android');
    });

    it('should return correct feature summary for Android', () => {
      const { getFeatureSummary } = require('../capabilities');
      const summary = getFeatureSummary();

      expect(summary).toEqual({
        platform: 'Android',
        bluetooth: 'Available',
        fileSystem: 'Available',
        backgroundTasks: 'Available',
        audioRecorder: 'expo-av',
        storage: 'sqlite',
      });
    });
  });

  describe('iOS Platform', () => {
    beforeEach(() => {
      mockPlatformOS = 'ios';
    });

    it('should enable all native features on iOS', () => {
      const { capabilities } = require('../capabilities');

      expect(capabilities.hasBluetooth).toBe(true);
      expect(capabilities.hasFileSystem).toBe(true);
      expect(capabilities.hasBackgroundTasks).toBe(true);
      expect(capabilities.audioRecorder).toBe('expo-av');
      expect(capabilities.storage).toBe('sqlite');
      expect(capabilities.platform).toBe('ios');
      expect(capabilities.isNative).toBe(true);
      expect(capabilities.isWeb).toBe(false);
    });

    it('should return correct platform name for iOS', () => {
      const { getPlatformName } = require('../capabilities');
      expect(getPlatformName()).toBe('iOS');
    });
  });

  describe('Web Platform', () => {
    beforeEach(() => {
      mockPlatformOS = 'web';
    });

    it('should disable native features on Web', () => {
      const { capabilities } = require('../capabilities');

      expect(capabilities.hasBluetooth).toBe(false);
      expect(capabilities.hasFileSystem).toBe(false);
      expect(capabilities.hasBackgroundTasks).toBe(false);
      expect(capabilities.audioRecorder).toBe('MediaRecorder');
      expect(capabilities.storage).toBe('dexie');
      expect(capabilities.platform).toBe('web');
      expect(capabilities.isNative).toBe(false);
      expect(capabilities.isWeb).toBe(true);
    });

    it('should return correct platform name for Web', () => {
      const { getPlatformName } = require('../capabilities');
      expect(getPlatformName()).toBe('Web Browser');
    });

    it('should return correct feature summary for Web', () => {
      const { getFeatureSummary } = require('../capabilities');
      const summary = getFeatureSummary();

      expect(summary).toEqual({
        platform: 'Web Browser',
        bluetooth: 'Not Available',
        fileSystem: 'Not Available',
        backgroundTasks: 'Not Available',
        audioRecorder: 'MediaRecorder',
        storage: 'dexie',
      });
    });
  });

  describe('hasCapability Helper', () => {
    beforeEach(() => {
      mockPlatformOS = 'android';
    });

    it('should return true for available boolean capabilities', () => {
      const { hasCapability } = require('../capabilities');

      expect(hasCapability('hasBluetooth')).toBe(true);
      expect(hasCapability('hasFileSystem')).toBe(true);
      expect(hasCapability('hasBackgroundTasks')).toBe(true);
      expect(hasCapability('isNative')).toBe(true);
    });

    it('should return false for non-boolean capabilities', () => {
      const { hasCapability } = require('../capabilities');

      // audioRecorder is a string, not boolean
      expect(hasCapability('audioRecorder')).toBe(false);
      expect(hasCapability('storage')).toBe(false);
      expect(hasCapability('platform')).toBe(false);
    });
  });

  describe('Web Platform - hasCapability', () => {
    beforeEach(() => {
      mockPlatformOS = 'web';
    });

    it('should return false for unavailable capabilities on Web', () => {
      const { hasCapability } = require('../capabilities');

      expect(hasCapability('hasBluetooth')).toBe(false);
      expect(hasCapability('hasFileSystem')).toBe(false);
      expect(hasCapability('hasBackgroundTasks')).toBe(false);
      expect(hasCapability('isNative')).toBe(false);
      expect(hasCapability('isWeb')).toBe(true);
    });
  });
});
