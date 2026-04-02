/**
 * Platform Capabilities Configuration
 *
 * Detects platform at bootstrap and configures available features accordingly.
 * Features are completely hidden (not grayed out) if unsupported on the current platform.
 *
 * Usage:
 * ```typescript
 * import { capabilities } from '@/config/capabilities';
 *
 * if (capabilities.hasBluetooth) {
 *   // Render Bluetooth button
 * }
 * ```
 */

import { Platform } from 'react-native';

/**
 * Audio recorder implementation type
 */
export type AudioRecorderType = 'MediaRecorder' | 'expo-av';

/**
 * Storage implementation type
 */
export type StorageType = 'dexie' | 'sqlite';

/**
 * Platform capabilities interface
 * All flags indicate whether a feature is available on the current platform
 */
export interface PlatformCapabilities {
  /**
   * Bluetooth connectivity available (Android/iOS only)
   */
  hasBluetooth: boolean;

  /**
   * Native file system access available (Android/iOS only)
   */
  hasFileSystem: boolean;

  /**
   * Background task support available (Android/iOS only)
   */
  hasBackgroundTasks: boolean;

  /**
   * Audio recorder implementation for the current platform
   * - 'MediaRecorder': Web API for browser-based recording
   * - 'expo-av': Native recording via Expo AV module
   */
  audioRecorder: AudioRecorderType;

  /**
   * Storage implementation for the current platform
   * - 'dexie': IndexedDB via Dexie.js (Web)
   * - 'sqlite': SQLite via expo-sqlite (Android/iOS)
   */
  storage: StorageType;

  /**
   * Current platform OS
   */
  platform: 'web' | 'android' | 'ios' | 'windows' | 'macos';

  /**
   * Whether the app is running on a native platform (Android/iOS)
   */
  isNative: boolean;

  /**
   * Whether the app is running on the web
   */
  isWeb: boolean;
}

/**
 * Detects platform and builds capability flags
 * Called once at bootstrap
 */
function detectPlatformCapabilities(): PlatformCapabilities {
  const isWeb = Platform.OS === 'web';
  const isNative = Platform.OS === 'android' || Platform.OS === 'ios';

  return {
    // Bluetooth only available on native platforms
    hasBluetooth: !isWeb,

    // Native file system only on Android/iOS
    hasFileSystem: !isWeb,

    // Background tasks only on native platforms
    hasBackgroundTasks: !isWeb,

    // Audio recorder implementation based on platform
    audioRecorder: isWeb ? 'MediaRecorder' : 'expo-av',

    // Storage implementation based on platform
    storage: isWeb ? 'dexie' : 'sqlite',

    // Platform information
    platform: Platform.OS as 'web' | 'android' | 'ios' | 'windows' | 'macos',
    isNative,
    isWeb,
  };
}

/**
 * Global capabilities object
 * Built once at module load time
 *
 * Import this anywhere to check platform capabilities:
 * ```typescript
 * import { capabilities } from '@/config/capabilities';
 *
 * if (capabilities.hasBluetooth) {
 *   // Show Bluetooth button
 * }
 *
 * if (capabilities.hasFileSystem) {
 *   // Enable file operations
 * }
 * ```
 */
export const capabilities: PlatformCapabilities = detectPlatformCapabilities();

/**
 * Helper function to check if a specific capability is available
 *
 * @param capability - Name of the capability to check
 * @returns true if the capability is available on the current platform
 *
 * @example
 * ```typescript
 * if (hasCapability('hasBluetooth')) {
 *   // Enable Bluetooth features
 * }
 * ```
 */
export function hasCapability(capability: keyof PlatformCapabilities): boolean {
  const value = capabilities[capability];
  return typeof value === 'boolean' ? value : false;
}

/**
 * Helper function to get the current platform name
 *
 * @returns Platform name as a readable string
 *
 * @example
 * ```typescript
 * console.log(`Running on ${getPlatformName()}`); // "Running on Android"
 * ```
 */
export function getPlatformName(): string {
  const platformNames: Record<string, string> = {
    web: 'Web Browser',
    android: 'Android',
    ios: 'iOS',
    windows: 'Windows',
    macos: 'macOS',
  };

  return platformNames[capabilities.platform] || 'Unknown Platform';
}

/**
 * Helper function to get feature availability summary
 * Useful for debugging or displaying platform info
 *
 * @returns Object with feature availability status
 *
 * @example
 * ```typescript
 * console.log('Platform features:', getFeatureSummary());
 * // {
 * //   platform: 'Android',
 * //   bluetooth: 'Available',
 * //   fileSystem: 'Available',
 * //   backgroundTasks: 'Available',
 * //   audioRecorder: 'expo-av',
 * //   storage: 'sqlite'
 * // }
 * ```
 */
export function getFeatureSummary() {
  return {
    platform: getPlatformName(),
    bluetooth: capabilities.hasBluetooth ? 'Available' : 'Not Available',
    fileSystem: capabilities.hasFileSystem ? 'Available' : 'Not Available',
    backgroundTasks: capabilities.hasBackgroundTasks ? 'Available' : 'Not Available',
    audioRecorder: capabilities.audioRecorder,
    storage: capabilities.storage,
  };
}

// Log capabilities on module load (dev only)
if (__DEV__) {
  console.log('[Capabilities] Platform detected:', getPlatformName());
  console.log('[Capabilities] Feature summary:', getFeatureSummary());
}

export default capabilities;
