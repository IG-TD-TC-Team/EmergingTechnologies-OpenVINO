/**
 * Capabilities Context and Provider
 *
 * Provides platform capabilities globally via React Context.
 * Use the `useCapabilities()` hook to access capabilities in any component.
 *
 * Usage:
 * ```tsx
 * // In App.js - wrap your app
 * <CapabilitiesProvider>
 *   <YourApp />
 * </CapabilitiesProvider>
 *
 * // In any component - use the hook
 * const capabilities = useCapabilities();
 * if (capabilities.hasBluetooth) {
 *   // Render Bluetooth UI
 * }
 * ```
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { capabilities, PlatformCapabilities } from './capabilities';

/**
 * Capabilities Context
 * Provides platform capabilities to all descendant components
 */
const CapabilitiesContext = createContext<PlatformCapabilities | undefined>(undefined);

/**
 * Provider Props
 */
interface CapabilitiesProviderProps {
  /**
   * Child components that will have access to capabilities
   */
  children: ReactNode;

  /**
   * Optional: Override capabilities (useful for testing)
   * If not provided, uses the auto-detected capabilities
   */
  value?: PlatformCapabilities;
}

/**
 * Capabilities Provider Component
 *
 * Wraps your app to provide capabilities via Context.
 * Must be placed high in the component tree (typically in App.js).
 *
 * @example
 * ```tsx
 * // App.js
 * import { CapabilitiesProvider } from '@/config/CapabilitiesContext';
 *
 * export default function App() {
 *   return (
 *     <CapabilitiesProvider>
 *       <Navigation />
 *     </CapabilitiesProvider>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Testing with custom capabilities
 * <CapabilitiesProvider value={{
 *   hasBluetooth: false,
 *   isWeb: true,
 *   // ...other flags
 * }}>
 *   <YourComponent />
 * </CapabilitiesProvider>
 * ```
 */
export function CapabilitiesProvider({ children, value }: CapabilitiesProviderProps) {
  // Use provided value (for testing) or default auto-detected capabilities
  const capabilitiesValue = value || capabilities;

  return (
    <CapabilitiesContext.Provider value={capabilitiesValue}>
      {children}
    </CapabilitiesContext.Provider>
  );
}

/**
 * Hook to access platform capabilities in any component
 *
 * Must be used inside a component wrapped by CapabilitiesProvider.
 * Throws an error if used outside the provider.
 *
 * @returns Platform capabilities object
 * @throws Error if used outside CapabilitiesProvider
 *
 * @example
 * ```tsx
 * function RecordingScreen() {
 *   const capabilities = useCapabilities();
 *
 *   return (
 *     <View>
 *       {capabilities.hasBluetooth && (
 *         <Button title="Connect Bluetooth" onPress={handleBluetooth} />
 *       )}
 *       {capabilities.isWeb && (
 *         <Button title="Use Browser Mic" onPress={handleWebMic} />
 *       )}
 *     </View>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Access specific flags
 * const { hasBluetooth, isWeb, audioRecorder } = useCapabilities();
 *
 * if (hasBluetooth) {
 *   // Show Bluetooth UI
 * }
 *
 * const recorder = audioRecorder === 'expo-av'
 *   ? new ExpoRecorder()
 *   : new MediaRecorder();
 * ```
 */
export function useCapabilities(): PlatformCapabilities {
  const context = useContext(CapabilitiesContext);

  if (context === undefined) {
    throw new Error(
      'useCapabilities must be used within a CapabilitiesProvider. ' +
      'Make sure to wrap your app with <CapabilitiesProvider> in App.js.'
    );
  }

  return context;
}

/**
 * Hook to check if a specific capability is available
 *
 * Convenience hook for checking boolean capabilities.
 * Returns false for non-boolean capabilities.
 *
 * @param capability - Name of the capability to check
 * @returns true if the capability is available
 *
 * @example
 * ```tsx
 * function BluetoothButton() {
 *   const hasBluetooth = useHasCapability('hasBluetooth');
 *
 *   if (!hasBluetooth) return null;
 *
 *   return <Button title="Connect Bluetooth" />;
 * }
 * ```
 */
export function useHasCapability(capability: keyof PlatformCapabilities): boolean {
  const capabilities = useCapabilities();
  const value = capabilities[capability];
  return typeof value === 'boolean' ? value : false;
}

/**
 * Hook to get the current platform name
 *
 * @returns Human-readable platform name
 *
 * @example
 * ```tsx
 * function PlatformInfo() {
 *   const platformName = usePlatformName();
 *   return <Text>Running on {platformName}</Text>;
 * }
 * ```
 */
export function usePlatformName(): string {
  const capabilities = useCapabilities();

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
 * Hook to check if running on a native platform (Android/iOS)
 *
 * @returns true if on Android or iOS
 *
 * @example
 * ```tsx
 * function FileExportButton() {
 *   const isNative = useIsNative();
 *
 *   if (!isNative) return null;
 *
 *   return <Button title="Export Files" onPress={handleExport} />;
 * }
 * ```
 */
export function useIsNative(): boolean {
  const capabilities = useCapabilities();
  return capabilities.isNative;
}

/**
 * Hook to check if running on web
 *
 * @returns true if on Web
 *
 * @example
 * ```tsx
 * function ServiceWorkerStatus() {
 *   const isWeb = useIsWeb();
 *
 *   if (!isWeb) return null;
 *
 *   return <Text>Service Worker: Active</Text>;
 * }
 * ```
 */
export function useIsWeb(): boolean {
  const capabilities = useCapabilities();
  return capabilities.isWeb;
}

// Re-export types for convenience
export type { PlatformCapabilities };
