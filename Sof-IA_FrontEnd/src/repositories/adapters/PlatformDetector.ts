/**
 * PlatformDetector - Runtime platform detection and capabilities
 *
 * Provides comprehensive platform detection beyond Platform.OS,
 * including browser detection, storage capabilities, and fallback logic.
 */

import { Platform } from 'react-native';

/**
 * Supported storage platforms
 */
export enum StoragePlatform {
  ANDROID = 'android',
  IOS = 'ios',
  WEB = 'web',
  UNKNOWN = 'unknown',
}

/**
 * Storage adapter types
 */
export enum AdapterType {
  SQLITE = 'sqlite',
  INDEXEDDB = 'indexeddb',
  MEMORY = 'memory', // Fallback for unsupported platforms
}

/**
 * Platform capabilities
 */
export interface PlatformCapabilities {
  platform: StoragePlatform;
  supportsIndexedDB: boolean;
  supportsSQLite: boolean;
  supportsWebSQL: boolean;
  isNative: boolean;
  isBrowser: boolean;
  browserName?: string;
  browserVersion?: string;
  recommendedAdapter: AdapterType;
}

export class PlatformDetector {
  private static capabilities: PlatformCapabilities | null = null;

  /**
   * Detect current platform and capabilities
   */
  static detect(): PlatformCapabilities {
    if (this.capabilities) {
      return this.capabilities;
    }

    const platform = this.detectPlatform();
    const capabilities: PlatformCapabilities = {
      platform,
      supportsIndexedDB: this.checkIndexedDBSupport(),
      supportsSQLite: this.checkSQLiteSupport(),
      supportsWebSQL: this.checkWebSQLSupport(),
      isNative: platform === StoragePlatform.ANDROID || platform === StoragePlatform.IOS,
      isBrowser: platform === StoragePlatform.WEB,
      recommendedAdapter: this.getRecommendedAdapter(platform),
    };

    // Detect browser info if on web
    if (platform === StoragePlatform.WEB) {
      const browserInfo = this.detectBrowser();
      capabilities.browserName = browserInfo.name;
      capabilities.browserVersion = browserInfo.version;
    }

    this.capabilities = capabilities;
    return capabilities;
  }

  /**
   * Detect base platform
   */
  private static detectPlatform(): StoragePlatform {
    const platformOS = Platform.OS;

    switch (platformOS) {
      case 'android':
        return StoragePlatform.ANDROID;
      case 'ios':
        return StoragePlatform.IOS;
      case 'web':
        return StoragePlatform.WEB;
      default:
        console.warn(`[PlatformDetector] Unknown platform: ${platformOS}`);
        return StoragePlatform.UNKNOWN;
    }
  }

  /**
   * Check IndexedDB support
   */
  private static checkIndexedDBSupport(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    try {
      return !!(
        window.indexedDB ||
        (window as any).mozIndexedDB ||
        (window as any).webkitIndexedDB ||
        (window as any).msIndexedDB
      );
    } catch {
      return false;
    }
  }

  /**
   * Check SQLite support (expo-sqlite available)
   */
  private static checkSQLiteSupport(): boolean {
    try {
      // Check if expo-sqlite module is available
      const SQLite = require('expo-sqlite');
      return !!SQLite.openDatabaseSync;
    } catch {
      return false;
    }
  }

  /**
   * Check WebSQL support (deprecated but may be fallback)
   */
  private static checkWebSQLSupport(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    try {
      return !!(window as any).openDatabase;
    } catch {
      return false;
    }
  }

  /**
   * Detect browser name and version
   */
  private static detectBrowser(): { name: string; version: string } {
    if (typeof window === 'undefined' || !window.navigator) {
      return { name: 'unknown', version: 'unknown' };
    }

    const userAgent = window.navigator.userAgent;

    // Chrome
    if (/Chrome/.test(userAgent) && /Google Inc/.test(window.navigator.vendor)) {
      const match = userAgent.match(/Chrome\/(\d+)/);
      return { name: 'Chrome', version: match ? match[1] : 'unknown' };
    }

    // Firefox
    if (/Firefox/.test(userAgent)) {
      const match = userAgent.match(/Firefox\/(\d+)/);
      return { name: 'Firefox', version: match ? match[1] : 'unknown' };
    }

    // Safari
    if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) {
      const match = userAgent.match(/Version\/(\d+)/);
      return { name: 'Safari', version: match ? match[1] : 'unknown' };
    }

    // Edge
    if (/Edg/.test(userAgent)) {
      const match = userAgent.match(/Edg\/(\d+)/);
      return { name: 'Edge', version: match ? match[1] : 'unknown' };
    }

    return { name: 'unknown', version: 'unknown' };
  }

  /**
   * Get recommended adapter for platform
   */
  private static getRecommendedAdapter(platform: StoragePlatform): AdapterType {
    switch (platform) {
      case StoragePlatform.ANDROID:
      case StoragePlatform.IOS:
        return AdapterType.SQLITE;

      case StoragePlatform.WEB:
        return this.checkIndexedDBSupport() ? AdapterType.INDEXEDDB : AdapterType.MEMORY;

      default:
        return AdapterType.MEMORY;
    }
  }

  /**
   * Check if platform can use SQLite
   */
  static canUseSQLite(): boolean {
    const caps = this.detect();
    return caps.isNative && caps.supportsSQLite;
  }

  /**
   * Check if platform can use IndexedDB
   */
  static canUseIndexedDB(): boolean {
    const caps = this.detect();
    return caps.isBrowser && caps.supportsIndexedDB;
  }

  /**
   * Get platform name
   */
  static getPlatform(): StoragePlatform {
    return this.detect().platform;
  }

  /**
   * Check if running on native platform
   */
  static isNative(): boolean {
    return this.detect().isNative;
  }

  /**
   * Check if running in browser
   */
  static isBrowser(): boolean {
    return this.detect().isBrowser;
  }

  /**
   * Get recommended adapter type
   */
  static getRecommendedAdapterType(): AdapterType {
    return this.detect().recommendedAdapter;
  }

  /**
   * Get detailed platform information
   */
  static getInfo(): string {
    const caps = this.detect();
    let info = `Platform: ${caps.platform}`;

    if (caps.browserName) {
      info += `\nBrowser: ${caps.browserName} ${caps.browserVersion}`;
    }

    info += `\nIndexedDB: ${caps.supportsIndexedDB ? '✓' : '✗'}`;
    info += `\nSQLite: ${caps.supportsSQLite ? '✓' : '✗'}`;
    info += `\nRecommended Adapter: ${caps.recommendedAdapter}`;

    return info;
  }

  /**
   * Reset cached capabilities (for testing)
   */
  static reset(): void {
    this.capabilities = null;
  }
}
