/**
 * Recording Mode Selection Screen
 *
 * Demonstrates conditional rendering based on platform capabilities:
 * - Bluetooth button: Only shown on Android/iOS (hidden on Web)
 * - Built-in mic: Always shown, but label varies by platform
 * - Audio recorder type: Selected based on capabilities
 *
 * This is an example component showing how to use capabilities for clean UI.
 */

import React from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { useCapabilities } from '../config/CapabilitiesContext';

export default function RecordingModeScreen({ navigation }) {
  const { hasBluetooth, isWeb, audioRecorder, platform } = useCapabilities();

  const handleBluetoothMode = () => {
    console.log('[RecordingMode] Bluetooth mode selected');
    // Navigate to Bluetooth setup screen
    navigation.navigate('BluetoothSetup');
  };

  const handleBuiltInMicMode = () => {
    console.log('[RecordingMode] Built-in mic mode selected');
    console.log(`[RecordingMode] Will use: ${audioRecorder}`);
    // Navigate to recording screen with appropriate recorder
    navigation.navigate('Recording', {
      mode: 'builtin',
      recorderType: audioRecorder,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Select Recording Mode</Text>
        <Text style={styles.subtitle}>
          Choose how you want to record audio
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Bluetooth Mode - ONLY on Android/iOS */}
        {hasBluetooth && (
          <TouchableOpacity
            style={styles.modeCard}
            onPress={handleBluetoothMode}
            activeOpacity={0.7}
          >
            <View style={styles.modeIcon}>
              <Text style={styles.iconText}>🎧</Text>
            </View>
            <View style={styles.modeInfo}>
              <Text style={styles.modeTitle}>Bluetooth Stethoscope</Text>
              <Text style={styles.modeDescription}>
                Connect a Bluetooth medical device for high-quality audio
                recording
              </Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Professional</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Built-in Microphone - ALWAYS shown */}
        <TouchableOpacity
          style={styles.modeCard}
          onPress={handleBuiltInMicMode}
          activeOpacity={0.7}
        >
          <View style={styles.modeIcon}>
            <Text style={styles.iconText}>🎤</Text>
          </View>
          <View style={styles.modeInfo}>
            <Text style={styles.modeTitle}>
              {isWeb ? 'Browser Microphone' : 'Built-in Microphone'}
            </Text>
            <Text style={styles.modeDescription}>
              {isWeb
                ? 'Record using your device microphone via the browser'
                : 'Record using your device built-in microphone'}
            </Text>
            <View style={[styles.badge, styles.badgeDefault]}>
              <Text style={styles.badgeText}>
                {isWeb ? 'Web Compatible' : 'Standard'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Platform Info (Debug - only in DEV) */}
        {__DEV__ && (
          <View style={styles.debugInfo}>
            <Text style={styles.debugTitle}>Platform Info (DEV)</Text>
            <Text style={styles.debugText}>Platform: {platform}</Text>
            <Text style={styles.debugText}>
              Bluetooth: {hasBluetooth ? 'Available' : 'Not Available'}
            </Text>
            <Text style={styles.debugText}>
              Audio Recorder: {audioRecorder}
            </Text>
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
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: '#1D1B20',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#757575',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  modeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    flexDirection: 'row',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  modeIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 32,
  },
  modeInfo: {
    flex: 1,
    gap: 8,
  },
  modeTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1D1B20',
  },
  modeDescription: {
    fontSize: 14,
    color: '#616161',
    lineHeight: 20,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#6B6EDF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeDefault: {
    backgroundColor: '#9E9E9E',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  debugInfo: {
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  debugTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#856404',
    marginBottom: 8,
  },
  debugText: {
    fontSize: 12,
    color: '#856404',
    fontFamily: 'monospace',
  },
});
