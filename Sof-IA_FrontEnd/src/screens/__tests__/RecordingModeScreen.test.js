/**
 * Tests for RecordingModeScreen
 * Verifies conditional rendering based on platform capabilities
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import RecordingModeScreen from '../RecordingModeScreen';
import { CapabilitiesProvider } from '../../config/CapabilitiesContext';

// Mock navigation
const mockNavigate = jest.fn();
const mockNavigation = {
  navigate: mockNavigate,
  goBack: jest.fn(),
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

describe('RecordingModeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Android Platform', () => {
    it('should show Bluetooth option on Android', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // Bluetooth option should be visible
      expect(getByText('Bluetooth Stethoscope')).toBeTruthy();
      expect(
        getByText(/Connect a Bluetooth medical device/i)
      ).toBeTruthy();
    });

    it('should show built-in microphone option on Android', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // Built-in mic should show native label
      expect(getByText('Built-in Microphone')).toBeTruthy();
      expect(
        getByText(/Record using your device built-in microphone/i)
      ).toBeTruthy();
    });

    it('should show both Bluetooth and built-in options on Android', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // Both options should be present
      expect(getByText('Bluetooth Stethoscope')).toBeTruthy();
      expect(getByText('Built-in Microphone')).toBeTruthy();
    });
  });

  describe('Web Platform', () => {
    it('should NOT show Bluetooth option on Web', () => {
      const { queryByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // Bluetooth option should NOT exist (completely hidden)
      expect(queryByText('Bluetooth Stethoscope')).toBeNull();
      expect(queryByText(/Connect a Bluetooth medical device/i)).toBeNull();
    });

    it('should show browser microphone option on Web', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // Built-in mic should show web-specific label
      expect(getByText('Browser Microphone')).toBeTruthy();
      expect(
        getByText(/Record using your device microphone via the browser/i)
      ).toBeTruthy();
    });

    it('should show web-compatible badge on Web', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByText('Web Compatible')).toBeTruthy();
    });

    it('should have exactly one recording option on Web', () => {
      const { queryByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // Should have browser microphone
      expect(queryByText('Browser Microphone')).toBeTruthy();

      // Should NOT have Bluetooth
      expect(queryByText('Bluetooth Stethoscope')).toBeNull();
    });
  });

  describe('UI Consistency', () => {
    it('should always show the header', () => {
      const { getByText: getByTextAndroid } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByTextAndroid('Select Recording Mode')).toBeTruthy();

      const { getByText: getByTextWeb } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByTextWeb('Select Recording Mode')).toBeTruthy();
    });

    it('should always show the subtitle', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      expect(getByText('Choose how you want to record audio')).toBeTruthy();
    });
  });

  describe('Clean UI - No Disabled Elements', () => {
    it('should completely hide Bluetooth on Web, not disable it', () => {
      const { queryByText, UNSAFE_queryAllByProps } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // Bluetooth text should not exist at all
      expect(queryByText('Bluetooth Stethoscope')).toBeNull();

      // Should not have any disabled TouchableOpacity for Bluetooth
      const disabledButtons = UNSAFE_queryAllByProps({ disabled: true });
      // Check that none of them contain Bluetooth text
      disabledButtons.forEach((button) => {
        expect(button.props.children).not.toContain('Bluetooth');
      });
    });

    it('should not gray out Bluetooth option on Web (because it should not exist)', () => {
      const { queryByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // Confirm Bluetooth option simply doesn't exist
      expect(queryByText('Bluetooth')).toBeNull();
    });
  });

  describe('Platform Detection', () => {
    it('should detect correct platform on Android', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={androidCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // In DEV mode, platform info should be visible
      if (__DEV__) {
        expect(getByText(/Platform: android/i)).toBeTruthy();
      }
    });

    it('should detect correct platform on Web', () => {
      const { getByText } = render(
        <CapabilitiesProvider value={webCapabilities}>
          <RecordingModeScreen navigation={mockNavigation} />
        </CapabilitiesProvider>
      );

      // In DEV mode, platform info should be visible
      if (__DEV__) {
        expect(getByText(/Platform: web/i)).toBeTruthy();
      }
    });
  });
});
