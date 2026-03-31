/**
 * Settings Screen
 *
 * Demonstrates conditional rendering of platform-specific features:
 * - File System Operations: Only on Android/iOS (hidden on Web)
 * - Background Tasks/Sync: Only on Android/iOS (hidden on Web)
 * - Service Worker Status: Only on Web (hidden on native)
 * - Storage Type: Shows platform-specific storage (SQLite vs Dexie)
 *
 * Features are COMPLETELY HIDDEN (not disabled/grayed out) when unsupported.
 */

import React, { useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import {
  useCapabilities,
  usePlatformName,
  useIsNative,
  useIsWeb,
} from '../config/CapabilitiesContext';

export default function SettingsScreen({ navigation }) {
  const capabilities = useCapabilities();
  const platformName = usePlatformName();
  const isNative = useIsNative();
  const isWeb = useIsWeb();

  // Settings state
  const [backgroundSyncEnabled, setBackgroundSyncEnabled] = useState(false);
  const [autoExportEnabled, setAutoExportEnabled] = useState(false);

  // Handlers
  const handleExportRecordings = () => {
    Alert.alert(
      'Export Recordings',
      'This will export all recordings to your device storage.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          onPress: () => console.log('[Settings] Exporting recordings...'),
        },
      ]
    );
  };

  const handleImportData = () => {
    Alert.alert(
      'Import Data',
      'Select a backup file to import.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Select File',
          onPress: () => console.log('[Settings] Opening file picker...'),
        },
      ]
    );
  };

  const handleBackgroundSyncToggle = (value) => {
    setBackgroundSyncEnabled(value);
    console.log(`[Settings] Background sync: ${value ? 'enabled' : 'disabled'}`);
  };

  const handleAutoExportToggle = (value) => {
    setAutoExportEnabled(value);
    console.log(`[Settings] Auto-export: ${value ? 'enabled' : 'disabled'}`);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Platform Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Platform Information</Text>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Platform</Text>
            <Text style={styles.settingValue}>{platformName}</Text>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Storage Type</Text>
            <Text style={styles.settingValue}>
              {capabilities.storage === 'sqlite' ? 'SQLite' : 'IndexedDB (Dexie)'}
            </Text>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Audio Recorder</Text>
            <Text style={styles.settingValue}>
              {capabilities.audioRecorder === 'expo-av'
                ? 'Expo AV (Native)'
                : 'MediaRecorder (Web)'}
            </Text>
          </View>
        </View>

        {/* File Management - ONLY on Android/iOS */}
        {capabilities.hasFileSystem && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>File Management</Text>
            <Text style={styles.sectionDescription}>
              Export and import your recordings and data
            </Text>

            <TouchableOpacity
              style={styles.button}
              onPress={handleExportRecordings}
            >
              <Text style={styles.buttonText}>📦 Export Recordings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.button}
              onPress={handleImportData}
            >
              <Text style={styles.buttonText}>📥 Import Data</Text>
            </TouchableOpacity>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Auto-Export</Text>
                <Text style={styles.settingHint}>
                  Automatically export recordings weekly
                </Text>
              </View>
              <Switch
                value={autoExportEnabled}
                onValueChange={handleAutoExportToggle}
                trackColor={{ false: '#E0E0E0', true: '#6B6EDF' }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>
        )}

        {/* Background Tasks - ONLY on Android/iOS */}
        {capabilities.hasBackgroundTasks && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Background Sync</Text>
            <Text style={styles.sectionDescription}>
              Sync data with the server in the background
            </Text>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Enable Background Sync</Text>
                <Text style={styles.settingHint}>
                  Sync when app is in background
                </Text>
              </View>
              <Switch
                value={backgroundSyncEnabled}
                onValueChange={handleBackgroundSyncToggle}
                trackColor={{ false: '#E0E0E0', true: '#6B6EDF' }}
                thumbColor="#FFFFFF"
              />
            </View>

            {backgroundSyncEnabled && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  ℹ️ Background sync will use battery and data. The app will
                  sync automatically when connected to WiFi.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Service Worker - ONLY on Web */}
        {isWeb && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Offline Mode</Text>
            <Text style={styles.sectionDescription}>
              Service Worker enables offline functionality
            </Text>

            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Service Worker</Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusText}>Active</Text>
              </View>
            </View>

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                ℹ️ The app can work offline thanks to Service Workers. Your
                data will sync when you're back online.
              </Text>
            </View>
          </View>
        )}

        {/* Common Settings - ALWAYS shown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>General</Text>

          <TouchableOpacity style={styles.settingRow}>
            <Text style={styles.settingLabel}>Language</Text>
            <Text style={styles.settingValue}>English</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingRow}>
            <Text style={styles.settingLabel}>Privacy Settings</Text>
            <Text style={styles.settingValue}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.settingRow}>
            <Text style={styles.settingLabel}>About</Text>
            <Text style={styles.settingValue}>v1.0.0</Text>
          </TouchableOpacity>
        </View>

        {/* Feature Availability (Debug - DEV only) */}
        {__DEV__ && (
          <View style={styles.debugSection}>
            <Text style={styles.debugTitle}>Feature Availability (DEV)</Text>
            <View style={styles.debugGrid}>
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>Bluetooth</Text>
                <Text style={capabilities.hasBluetooth ? styles.debugAvailable : styles.debugUnavailable}>
                  {capabilities.hasBluetooth ? '✓ Available' : '✗ Not Available'}
                </Text>
              </View>
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>File System</Text>
                <Text style={capabilities.hasFileSystem ? styles.debugAvailable : styles.debugUnavailable}>
                  {capabilities.hasFileSystem ? '✓ Available' : '✗ Not Available'}
                </Text>
              </View>
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>Background Tasks</Text>
                <Text style={capabilities.hasBackgroundTasks ? styles.debugAvailable : styles.debugUnavailable}>
                  {capabilities.hasBackgroundTasks ? '✓ Available' : '✗ Not Available'}
                </Text>
              </View>
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>Is Native</Text>
                <Text style={isNative ? styles.debugAvailable : styles.debugUnavailable}>
                  {isNative ? '✓ Yes' : '✗ No'}
                </Text>
              </View>
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>Is Web</Text>
                <Text style={isWeb ? styles.debugAvailable : styles.debugUnavailable}>
                  {isWeb ? '✓ Yes' : '✗ No'}
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  backButton: {
    padding: 4,
  },
  backText: {
    fontSize: 16,
    color: '#6B6EDF',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1D1B20',
  },
  content: {
    padding: 16,
    gap: 24,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1D1B20',
  },
  sectionDescription: {
    fontSize: 14,
    color: '#757575',
    marginBottom: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    color: '#1D1B20',
  },
  settingValue: {
    fontSize: 16,
    color: '#757575',
  },
  settingHint: {
    fontSize: 12,
    color: '#9E9E9E',
    marginTop: 2,
  },
  button: {
    backgroundColor: '#6B6EDF',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  statusBadge: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  infoBox: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  infoText: {
    fontSize: 14,
    color: '#0D47A1',
    lineHeight: 20,
  },
  debugSection: {
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  debugTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#856404',
    marginBottom: 12,
  },
  debugGrid: {
    gap: 8,
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  debugLabel: {
    fontSize: 12,
    color: '#856404',
    fontFamily: 'monospace',
  },
  debugAvailable: {
    fontSize: 12,
    color: '#155724',
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  debugUnavailable: {
    fontSize: 12,
    color: '#721c24',
    fontWeight: '600',
    fontFamily: 'monospace',
  },
});
