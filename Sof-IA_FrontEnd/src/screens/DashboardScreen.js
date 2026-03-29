/**
 * DashboardScreen
 *
 * View only — no business logic.
 * All logic lives in DashboardPresenter.
 */

import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DashboardPresenter from '../presenters/DashboardPresenter';
import { AudioSourceBadge, MicInputIcon } from './AudioSourceBadge';
import { MicPermissionBanner } from './MicPermissionBanner';

function DashboardScreen() {
  const [audioSource, setAudioSource] = useState({
    sourceKey: 'builtin',
    sourceLabel: 'Built-in mic',
    canToggle: false,
  });
  const [micStatus, setMicStatus] = useState('undetermined');
  const [isRecording, setRecording] = useState(false);

  const presenterRef = useRef(null);

  useEffect(() => {
    const view = { setAudioSource, setMicStatus, setRecording };
    const presenter = new DashboardPresenter(view);
    presenterRef.current = presenter;
    presenter.mount();
    return () => presenter.unmount();
  }, []);

  return (
      <SafeAreaView style={styles.container}>

        {/* US20 — permission banner */}
        <MicPermissionBanner
            status={micStatus}
            onRequestPermission={() => presenterRef.current?.onRequestPermission()}
            onOpenSettings={() => presenterRef.current?.onOpenSettings()}
        />

        {/* US7 — audio source badge (tappable when USB is connected) */}
        <View style={styles.sourceRow}>
          <AudioSourceBadge
              sourceKey={audioSource.sourceKey}
              sourceLabel={audioSource.sourceLabel}
              canToggle={audioSource.canToggle}
              onPress={() => presenterRef.current?.onToggleSource()}
          />
        </View>

        {/* Placeholder — will be implemented in a future sprint (US #4) */}
        <View style={styles.content}>
          <Text style={styles.text}>Dashboard — coming soon</Text>
        </View>

        {/* Bottom action bar — US7 */}
        <View style={styles.bottomBar}>

          <View style={styles.barItem}>
            <MicInputIcon sourceKey={audioSource.sourceKey} />
            <Text style={styles.barLabel}>{audioSource.sourceLabel}</Text>
          </View>

          <TouchableOpacity
              style={[styles.micButton, isRecording && styles.micButtonRecording]}
              onPress={() => presenterRef.current?.onMicPress()}
              disabled={micStatus === 'blocked'}
              accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
          >
            <View style={styles.micButtonInner} />
          </TouchableOpacity>

          {/* Speaker — AI volume, disabled in v1 (US7 spec) */}
          <View style={[styles.barItem, styles.barItemDisabled]}>
            <View style={styles.speakerPlaceholder} />
            <Text style={[styles.barLabel, styles.barLabelDisabled]}>AI volume</Text>
          </View>

        </View>
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  sourceRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 18,
    color: '#1D1B20',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 0.5,
    borderTopColor: '#D3D1C7',
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#FFFFFF',
  },
  barItem: { alignItems: 'center', gap: 4 },
  barItemDisabled: { opacity: 0.4 },
  barLabel: { fontSize: 10, color: '#5F5E5A' },
  barLabelDisabled: { color: '#B4B2A9' },
  micButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonRecording: { backgroundColor: '#A32D2D' },
  micButtonInner: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  speakerPlaceholder: { width: 24, height: 24, borderRadius: 4, backgroundColor: '#B4B2A9' },
});

export default DashboardScreen;