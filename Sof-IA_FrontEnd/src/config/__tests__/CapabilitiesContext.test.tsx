/**
 * Tests for CapabilitiesContext and hooks
 */

import React from 'react';
import { renderHook, render } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import {
  CapabilitiesProvider,
  useCapabilities,
  useHasCapability,
  usePlatformName,
  useIsNative,
  useIsWeb,
} from '../CapabilitiesContext';
import { PlatformCapabilities } from '../capabilities';

// Mock capabilities for testing
const mockAndroidCapabilities: PlatformCapabilities = {
  hasBluetooth: true,
  hasFileSystem: true,
  hasBackgroundTasks: true,
  audioRecorder: 'expo-av',
  storage: 'sqlite',
  platform: 'android',
  isNative: true,
  isWeb: false,
};

const mockWebCapabilities: PlatformCapabilities = {
  hasBluetooth: false,
  hasFileSystem: false,
  hasBackgroundTasks: false,
  audioRecorder: 'MediaRecorder',
  storage: 'dexie',
  platform: 'web',
  isNative: false,
  isWeb: true,
};

describe('CapabilitiesContext', () => {
  describe('CapabilitiesProvider', () => {
    it('should provide capabilities to children', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockAndroidCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(() => useCapabilities(), { wrapper });

      expect(result.current).toEqual(mockAndroidCapabilities);
    });

    it('should use auto-detected capabilities if no value provided', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider>{children}</CapabilitiesProvider>
      );

      const { result } = renderHook(() => useCapabilities(), { wrapper });

      // Should return the actual capabilities object
      expect(result.current).toBeDefined();
      expect(result.current).toHaveProperty('hasBluetooth');
      expect(result.current).toHaveProperty('hasFileSystem');
      expect(result.current).toHaveProperty('hasBackgroundTasks');
    });

    it('should allow custom capabilities for testing', () => {
      const customCapabilities: PlatformCapabilities = {
        ...mockWebCapabilities,
        hasBluetooth: true, // Override for testing
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={customCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(() => useCapabilities(), { wrapper });

      expect(result.current.hasBluetooth).toBe(true);
      expect(result.current.isWeb).toBe(true);
    });
  });

  describe('useCapabilities hook', () => {
    it('should return capabilities object', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockAndroidCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(() => useCapabilities(), { wrapper });

      expect(result.current.hasBluetooth).toBe(true);
      expect(result.current.hasFileSystem).toBe(true);
      expect(result.current.hasBackgroundTasks).toBe(true);
      expect(result.current.audioRecorder).toBe('expo-av');
      expect(result.current.storage).toBe('sqlite');
      expect(result.current.isNative).toBe(true);
      expect(result.current.isWeb).toBe(false);
    });

    it('should throw error when used outside provider', () => {
      // Suppress console.error for this test
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      expect(() => {
        renderHook(() => useCapabilities());
      }).toThrow('useCapabilities must be used within a CapabilitiesProvider');

      consoleError.mockRestore();
    });

    it('should allow destructuring capabilities', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockAndroidCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(
        () => {
          const { hasBluetooth, isNative, audioRecorder } = useCapabilities();
          return { hasBluetooth, isNative, audioRecorder };
        },
        { wrapper }
      );

      expect(result.current.hasBluetooth).toBe(true);
      expect(result.current.isNative).toBe(true);
      expect(result.current.audioRecorder).toBe('expo-av');
    });
  });

  describe('useHasCapability hook', () => {
    it('should return true for available boolean capabilities', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockAndroidCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result: hasBluetooth } = renderHook(
        () => useHasCapability('hasBluetooth'),
        { wrapper }
      );
      const { result: hasFileSystem } = renderHook(
        () => useHasCapability('hasFileSystem'),
        { wrapper }
      );

      expect(hasBluetooth.current).toBe(true);
      expect(hasFileSystem.current).toBe(true);
    });

    it('should return false for unavailable boolean capabilities', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockWebCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result: hasBluetooth } = renderHook(
        () => useHasCapability('hasBluetooth'),
        { wrapper }
      );
      const { result: isNative } = renderHook(
        () => useHasCapability('isNative'),
        { wrapper }
      );

      expect(hasBluetooth.current).toBe(false);
      expect(isNative.current).toBe(false);
    });

    it('should return false for non-boolean capabilities', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockAndroidCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result: audioRecorder } = renderHook(
        () => useHasCapability('audioRecorder'),
        { wrapper }
      );
      const { result: storage } = renderHook(
        () => useHasCapability('storage'),
        { wrapper }
      );

      expect(audioRecorder.current).toBe(false);
      expect(storage.current).toBe(false);
    });
  });

  describe('usePlatformName hook', () => {
    it('should return "Android" for Android platform', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockAndroidCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(() => usePlatformName(), { wrapper });

      expect(result.current).toBe('Android');
    });

    it('should return "Web Browser" for Web platform', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockWebCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(() => usePlatformName(), { wrapper });

      expect(result.current).toBe('Web Browser');
    });

    it('should return "iOS" for iOS platform', () => {
      const iOSCapabilities: PlatformCapabilities = {
        ...mockAndroidCapabilities,
        platform: 'ios',
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={iOSCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(() => usePlatformName(), { wrapper });

      expect(result.current).toBe('iOS');
    });
  });

  describe('useIsNative hook', () => {
    it('should return true for Android', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockAndroidCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(() => useIsNative(), { wrapper });

      expect(result.current).toBe(true);
    });

    it('should return false for Web', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockWebCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(() => useIsNative(), { wrapper });

      expect(result.current).toBe(false);
    });
  });

  describe('useIsWeb hook', () => {
    it('should return false for Android', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockAndroidCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(() => useIsWeb(), { wrapper });

      expect(result.current).toBe(false);
    });

    it('should return true for Web', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockWebCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(() => useIsWeb(), { wrapper });

      expect(result.current).toBe(true);
    });
  });

  describe('Component integration', () => {
    it('should allow capabilities to be used in components via hook', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockAndroidCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(
        () => {
          const capabilities = useCapabilities();
          const isNative = useIsNative();
          const isWeb = useIsWeb();
          const platformName = usePlatformName();
          const hasBluetooth = useHasCapability('hasBluetooth');

          return { capabilities, isNative, isWeb, platformName, hasBluetooth };
        },
        { wrapper }
      );

      expect(result.current.capabilities.platform).toBe('android');
      expect(result.current.isNative).toBe(true);
      expect(result.current.isWeb).toBe(false);
      expect(result.current.platformName).toBe('Android');
      expect(result.current.hasBluetooth).toBe(true);
    });

    it('should support conditional logic based on capabilities', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CapabilitiesProvider value={mockWebCapabilities}>
          {children}
        </CapabilitiesProvider>
      );

      const { result } = renderHook(
        () => {
          const capabilities = useCapabilities();

          // Simulate component logic
          const showBluetoothUI = capabilities.hasBluetooth;
          const showWebUI = capabilities.isWeb;
          const useMediaRecorder = capabilities.audioRecorder === 'MediaRecorder';

          return { showBluetoothUI, showWebUI, useMediaRecorder };
        },
        { wrapper }
      );

      expect(result.current.showBluetoothUI).toBe(false);
      expect(result.current.showWebUI).toBe(true);
      expect(result.current.useMediaRecorder).toBe(true);
    });
  });
});
