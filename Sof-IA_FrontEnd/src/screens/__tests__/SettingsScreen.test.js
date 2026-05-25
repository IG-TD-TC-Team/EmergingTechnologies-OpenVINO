/**
 * Tests for SettingsScreen
 * Verifies conditional rendering of platform-specific features
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import SettingsScreen from '../SettingsScreen';
import { CapabilitiesProvider } from '../../config/CapabilitiesContext';

// Mock navigation
const mockGoBack = jest.fn();
const mockNavigation = {
  goBack: mockGoBack,
  navigate: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(true),
};

// Android capabilities
const androidCapabilities = {
  hasBluetooth: true,
  hasFileSystem: true,
  hasBackgroundTasks: true,
  audioRecorder: 'expo-av',
  storage: 'sqlite',
  platform: 'android',
  isNative: true,
  isWeb: false,
};

// Web capabilities
const webCapabilities = {
  hasBluetooth: false,
  hasFileSystem: false,
  hasBackgroundTasks: false,
  audioRecorder: 'MediaRecorder',
  storage: 'dexie',
  platform: 'web',
  isNative: false,
  isWeb: true,
};

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Android Platform', () => {
    it('should NOT show service worker section on Android', () => {
      const { queryByText } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(queryByText('Offline Mode')).toBeNull();
      expect(queryByText('Service Worker')).toBeNull();
    });

    it('should show SQLite as storage type on Android', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByText('SQLite')).toBeTruthy();
    });
  });

  describe('Web Platform', () => {
    it('should NOT show file management section on Web', () => {
      const { queryByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(queryByText('File Management')).toBeNull();
      expect(queryByText(/Export Recordings/i)).toBeNull();
      expect(queryByText(/Import Data/i)).toBeNull();
    });

    it('should NOT show background sync section on Web', () => {
      const { queryByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(queryByText('Background Sync')).toBeNull();
      expect(queryByText('Enable Background Sync')).toBeNull();
    });

    it('should show service worker section on Web', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByText('Offline Mode')).toBeTruthy();
      expect(getByText(/Service Worker enables offline/i)).toBeTruthy();
      expect(getByText('Service Worker')).toBeTruthy();
      expect(getByText('Active')).toBeTruthy();
    });

    it('should show IndexedDB as storage type on Web', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByText('IndexedDB (Dexie)')).toBeTruthy();
    });
  });

  describe('Common Settings', () => {
    it('should always show platform information section', () => {
      const { getByText: getByTextAndroid } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByTextAndroid('Platform Information')).toBeTruthy();

      const { getByText: getByTextWeb } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByTextWeb('Platform Information')).toBeTruthy();
    });

    it('should always show server connection section', () => {
      const { getByText: getByTextAndroid } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByTextAndroid('Server Connection')).toBeTruthy();

      const { getByText: getByTextWeb } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByTextWeb('Server Connection')).toBeTruthy();
    });
  });

  describe('Clean UI - Features Completely Hidden', () => {
    it('should not have file management section at all on Web', () => {
      const { UNSAFE_queryByType } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // The entire file management section should not exist
      const { queryByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(queryByText('Export Recordings')).toBeNull();
      expect(queryByText('Import Data')).toBeNull();
      expect(queryByText('Auto-Export')).toBeNull();
    });

    it('should not have background sync controls at all on Web', () => {
      const { queryByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(queryByText('Background Sync')).toBeNull();
      expect(queryByText('Enable Background Sync')).toBeNull();
    });

    it('should not have service worker section at all on Android', () => {
      const { queryByText } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(queryByText('Offline Mode')).toBeNull();
      expect(queryByText(/Service Worker enables/i)).toBeNull();
    });
  });

  describe('Platform-Specific Labels', () => {
    it('should show native audio recorder on Android', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByText('Expo AV (Native)')).toBeTruthy();
    });

    it('should show web audio recorder on Web', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByText('MediaRecorder (Web)')).toBeTruthy();
    });

    it('should show correct platform name', () => {
      const { getByText: getByTextAndroid } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByTextAndroid('Android')).toBeTruthy();

      const { getByText: getByTextWeb } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByTextWeb('Web Browser')).toBeTruthy();
    });
  });

  describe('Feature Count Difference', () => {
    it('should have more settings sections on Android than Web', () => {
      const { queryAllByText: queryAllAndroid } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      const { queryAllByText: queryAllWeb } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <SettingsScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // Android should have: Platform Info, Server Connection
      // Web should have: Platform Info, Server Connection, Offline Mode

      const androidSections = [
        'Platform Information',
        'Server Connection',
      ];

      const webSections = [
        'Platform Information',
        'Server Connection',
        'Offline Mode',
      ];

      androidSections.forEach((section) => {
        expect(queryAllAndroid(section).length).toBeGreaterThan(0);
      });

      webSections.forEach((section) => {
        expect(queryAllWeb(section).length).toBeGreaterThan(0);
      });
    });
  });
});
