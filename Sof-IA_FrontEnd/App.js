import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { StorageFactory, LogLevel } from './src/repositories/adapters';
import { CapabilitiesProvider } from './src/config/CapabilitiesContext';
import { RecordingProvider, useRecordingContext } from './src/contexts/RecordingContext';
import RecordingIndicator from './src/screens/RecordingIndicator';

export default function App() {
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [storageError, setStorageError] = useState(null);

  useEffect(() => {
    /**
     * Bootstrap: Initialize storage and purge expired records on app launch
     */
    async function initializeStorage() {
      try {
        console.log('[Bootstrap] Initializing storage...');

        // Create storage instance with platform detection
        const storage = await StorageFactory.create({
          databaseName: 'sofia',
          enableLogging: __DEV__,
          logLevel: __DEV__ ? LogLevel.DEBUG : LogLevel.ERROR,
          enablePerformanceMonitoring: __DEV__,
          enableHealthChecks: true,
        });

        console.log('[Bootstrap] Storage initialized successfully');

        // Purge expired records before app starts
        console.log('[Bootstrap] Purging expired records...');
        const purgedCount = await storage.purgeExpired();
        console.log(`[Bootstrap] Purged ${purgedCount} expired record(s)`);

        // Mark storage as ready
        setIsStorageReady(true);
      } catch (error) {
        console.error('[Bootstrap] Failed to initialize storage:', error);
        setStorageError(error);
        // Still mark as ready to allow app to run (with degraded functionality)
        setIsStorageReady(true);
      }
    }

    initializeStorage();
  }, []);

  // Show loading indicator while storage initializes
  if (!isStorageReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6B6EDF" />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <CapabilitiesProvider>
      <RecordingProvider>
        <AppContent />
      </RecordingProvider>
    </CapabilitiesProvider>
  );
}

/**
 * Inner component that reads RecordingContext so RecordingIndicator
 * stays mounted across all screen transitions.
 */
function AppContent() {
  const { isRecording, connectionStatus } = useRecordingContext();

  return (
    <View style={{ flex: 1 }}>
      <AppNavigator />
      <RecordingIndicator isRecording={isRecording} connectionStatus={connectionStatus} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
