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

import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import {
  useCapabilities,
  usePlatformName,
  useIsWeb,
} from '../config/CapabilitiesContext';
import ApiConfigService from '../services/ApiConfigService';

const arrowBackSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#1D1B20"/>
</svg>`;

export default function SettingsScreen({ navigation }) {
  const capabilities = useCapabilities();
  const platformName = usePlatformName();
  const isWeb = useIsWeb();

  // API URL state
  const [apiUrl, setApiUrl] = useState('');
  const [apiUrlSaved, setApiUrlSaved] = useState(false);

  useEffect(() => {
    ApiConfigService.getApiUrl().then(setApiUrl);
  }, []);

  const handleSaveApiUrl = async () => {
    if (!apiUrl.trim()) return;
    await ApiConfigService.setApiUrl(apiUrl.trim());
    setApiUrlSaved(true);
    setTimeout(() => setApiUrlSaved(false), 2000);
  };

  const handleResetApiUrl = async () => {
    await ApiConfigService.reset();
    setApiUrl(ApiConfigService.getDefault());
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ModeSelection')}
          style={styles.backButton}
          accessibilityLabel="Go back"
        >
          <SvgXml xml={arrowBackSvg} width={24} height={24} />
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

        {/* Server Connection - ALWAYS shown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Server Connection</Text>
          <Text style={styles.sectionDescription}>
            Backend API URL used for voice transcription
          </Text>
          <TextInput
            style={styles.urlInput}
            value={apiUrl}
            onChangeText={setApiUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://localhost:8000"
            placeholderTextColor="#9E9E9E"
          />
          <Text style={styles.urlHint}>
            Default: {ApiConfigService.getDefault()}
          </Text>
          <View style={styles.urlActions}>
            <TouchableOpacity style={styles.urlResetBtn} onPress={handleResetApiUrl}>
              <Text style={styles.urlResetText}>Reset to default</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.urlSaveBtn} onPress={handleSaveApiUrl}>
              <Text style={styles.urlSaveText}>
                {apiUrlSaved ? 'Saved' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

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
    marginRight: 4,
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
  urlInput: {
    borderWidth: 1,
    borderColor: '#CAC4D0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1D1B20',
    fontFamily: 'monospace',
  },
  urlHint: {
    fontSize: 11,
    color: '#9E9E9E',
    fontFamily: 'monospace',
  },
  urlActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  urlResetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CAC4D0',
  },
  urlResetText: {
    fontSize: 13,
    color: '#5F5E5A',
  },
  urlSaveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#1D9E75',
  },
  urlSaveText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
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
});
