/**
 * DashboardScreen
 *
 * View only — no business logic.
 * All logic lives in DashboardPresenter.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import DashboardPresenter from '../presenters/DashboardPresenter';
import { AudioSourceBadge, MicInputIcon } from './AudioSourceBadge';
import { MicPermissionBanner } from './MicPermissionBanner';
import MicButton from './MicButton';
import { useRecordingContext } from '../contexts/RecordingContext';

// --- SVG icons ---

const arrowBackSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#1D1B20"/>
</svg>`;

const briefcaseSvg = `<svg width="48" height="44" viewBox="0 0 44 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M30 38V6C30 4.93913 29.5786 3.92172 28.8284 3.17157C28.0783 2.42143 27.0609 2 26 2H18C16.9391 2 15.9217 2.42143 15.1716 3.17157C14.4214 3.92172 14 4.93913 14 6V38M6 10H38C40.2091 10 42 11.7909 42 14V34C42 36.2091 40.2091 38 38 38H6C3.79086 38 2 36.2091 2 34V14C2 11.7909 3.79086 10 6 10Z" stroke="#1E1E1E" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const bedSvg = `<svg width="43" height="43" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 32V12H8V24H28V16H40C42.2 16 44 17.8 44 20V32H40V28H8V32H4ZM14 22C11.8 22 10 20.2 10 18C10 15.8 11.8 14 14 14C16.2 14 18 15.8 18 18C18 20.2 16.2 22 14 22Z" fill="#1D1B20"/>
</svg>`;

// --- Bed Card Component ---

function BedCard({ bed, name, onPress }) {
  return (
    <TouchableOpacity style={styles.bedCard} onPress={onPress} activeOpacity={0.7}>
      <SvgXml xml={bedSvg} width={43} height={43} />
      <View style={styles.bedChip}>
        <Text style={styles.bedChipText} numberOfLines={1}>
          {`Bed ${bed}: "${name}"`}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// --- Screen ---

function DashboardScreen({ navigation }) {
  const [audioSource, setAudioSource] = useState({
    sourceKey: 'builtin',
    sourceLabel: 'Built-in mic',
    canToggle: false,
  });
  const [micStatus, setMicStatus] = useState('undetermined');
  const [beds, setBeds] = useState([]);
  const [bedsLoading, setBedsLoading] = useState(true);

  // Recording state lives in context so RecordingIndicator in App.js stays in sync
  const { isRecording, setIsRecording, setConnectionStatus } = useRecordingContext();

  const presenterRef = useRef(null);

  useEffect(() => {
    const view = {
      setAudioSource,
      setMicStatus,
      setRecording: setIsRecording,
      setConnectionStatus,
      setBeds,
      setBedsLoading,
    };
    const presenter = new DashboardPresenter(view);
    presenterRef.current = presenter;
    presenter.mount();
    return () => presenter.unmount();
  }, []);

  return (
    <SafeAreaView style={styles.container}>

      {/* Header: back arrow + briefcase + title */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
        >
          <SvgXml xml={arrowBackSvg} width={24} height={24} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <SvgXml xml={briefcaseSvg} width={48} height={44} />
          <Text style={styles.headerTitle}>Talk with Sofia</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* US20 — permission banner */}
      <MicPermissionBanner
        status={micStatus}
        onRequestPermission={() => presenterRef.current?.onRequestPermission()}
        onOpenSettings={() => presenterRef.current?.onOpenSettings()}
      />

      {/* US7 — audio source badge */}
      <View style={styles.sourceRow}>
        <AudioSourceBadge
          style={{ alignSelf: 'center' }}
          sourceKey={audioSource.sourceKey}
          sourceLabel={audioSource.sourceLabel}
          canToggle={audioSource.canToggle}
          onPress={() => presenterRef.current?.onToggleSource()}
        />
      </View>

      {/* Bed mapping section */}
      <View style={styles.content}>
        <View style={styles.sectionChip}>
          <Text style={styles.sectionChipText}>Bed mapping</Text>
        </View>

        {bedsLoading ? (
          <ActivityIndicator style={styles.loader} color="#1D1B20" />
        ) : beds.length === 0 ? (
          <Text style={styles.emptyText}>No beds assigned</Text>
        ) : (
          <FlatList
            data={beds}
            keyExtractor={(item) => item.id}
            numColumns={3}
            columnWrapperStyle={styles.bedRow}
            contentContainerStyle={styles.bedGrid}
            renderItem={({ item }) => (
              <BedCard
                bed={item.bed}
                name={item.name}
                onPress={() => presenterRef.current?.onBedPress(item, navigation)}
              />
            )}
          />
        )}
      </View>

      {/* Bottom action bar — US7 */}
      <View style={styles.bottomBar}>
        <View style={styles.barItem}>
          <MicInputIcon sourceKey={audioSource.sourceKey} />
          <Text style={styles.barLabel}>{audioSource.sourceLabel}</Text>
        </View>

        <MicButton
          isRecording={isRecording}
          isDisabled={micStatus === 'blocked'}
          onPress={() => presenterRef.current?.onMicPress()}
        />

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
  // ─── Header ──────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    color: '#767676',
    marginTop: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#B2B2B2',
    paddingBottom: 2,
  },
  headerSpacer: {
    width: 48,
  },
  // ─── Audio source ────────────────────────────────────────
  sourceRow: {
    alignItems: 'center',
    paddingTop: 8,
  },
  // ─── Bed mapping ─────────────────────────────────────────
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sectionChip: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#CAC4D0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 16,
  },
  sectionChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1D1B20',
  },
  loader: {
    marginTop: 32,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    color: '#767676',
    marginTop: 32,
  },
  bedGrid: {
    paddingBottom: 16,
  },
  bedRow: {
    justifyContent: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  bedCard: {
    alignItems: 'center',
    width: '30%',
  },
  bedChip: {
    borderWidth: 1,
    borderColor: '#CAC4D0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 4,
  },
  bedChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1D1B20',
    textAlign: 'center',
  },
  // ─── Bottom bar ──────────────────────────────────────────
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
  speakerPlaceholder: { width: 24, height: 24, borderRadius: 4, backgroundColor: '#B4B2A9' },
});

export default DashboardScreen;
