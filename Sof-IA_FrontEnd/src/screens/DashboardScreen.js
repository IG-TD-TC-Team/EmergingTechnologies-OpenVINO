/**
 * DashboardScreen
 *
 * View only — no business logic.
 * All logic lives in DashboardPresenter.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
    Animated,
  FlatList,
  Platform,
  Modal,
  Pressable,
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
import { useRecordingContext } from '../contexts/RecordingContext';
import SyncStatusIndicator from '../components/SyncStatusIndicator';
import { useQueueNotifications } from '../hooks/useQueueNotifications';

// --- SVG icons ---

const arrowBackSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#1D1B20"/>
</svg>`;

// Door/exit icon for End Shift
const endShiftSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10.09 15.59L11.5 17L16.5 12L11.5 7L10.09 8.41L12.67 11H3V13H12.67L10.09 15.59ZM19 3H5C3.89 3 3 3.9 3 5V9H5V5H19V19H5V15H3V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3Z" fill="#A32D2D"/>
</svg>`;

const briefcaseSvg = `<svg width="48" height="44" viewBox="0 0 44 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M30 38V6C30 4.93913 29.5786 3.92172 28.8284 3.17157C28.0783 2.42143 27.0609 2 26 2H18C16.9391 2 15.9217 2.42143 15.1716 3.17157C14.4214 3.92172 14 4.93913 14 6V38M6 10H38C40.2091 10 42 11.7909 42 14V34C42 36.2091 40.2091 38 38 38H6C3.79086 38 2 36.2091 2 34V14C2 11.7909 3.79086 10 6 10Z" stroke="#1E1E1E" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const checkCircleSvg = `<svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="28" cy="28" r="28" fill="#E8F7F2"/>
  <path d="M18 28.5L24.5 35L38 21" stroke="#1D9E75" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const warningTriangleSvg = `<svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="28" cy="28" r="28" fill="#FEF3EE"/>
  <path d="M28 20V30M28 35V36M18 38H38L28 18L18 38Z" stroke="#C45C2E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const bedSvg = `<svg width="43" height="43" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 32V12H8V24H28V16H40C42.2 16 44 17.8 44 20V32H40V28H8V32H4ZM14 22C11.8 22 10 20.2 10 18C10 15.8 11.8 14 14 14C16.2 14 18 15.8 18 18C18 20.2 16.2 22 14 22Z" fill="#1D1B20"/>
</svg>`;

const micSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 14C13.66 14 15 12.66 15 11V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 12.66 10.34 14 12 14ZM17.91 11C17.42 13.84 14.97 16 12 16C9.03 16 6.58 13.84 6.09 11H4.07C4.57 14.55 7.25 17.44 10.75 17.91V21H13.25V17.91C16.75 17.44 19.43 14.55 19.93 11H17.91Z" fill="white"/>
</svg>`;

const stopSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="6" width="12" height="12" rx="2" fill="white"/>
</svg>`;

const bedActiveSvg = `<svg width="43" height="43" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 32V12H8V24H28V16H40C42.2 16 44 17.8 44 20V32H40V28H8V32H4ZM14 22C11.8 22 10 20.2 10 18C10 15.8 11.8 14 14 14C16.2 14 18 15.8 18 18C18 20.2 16.2 22 14 22Z" fill="#1D9E75"/>
</svg>`;

// Close icon for the active patient chip
const closeSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z" fill="#1D9E75"/>
</svg>`;
// --- Bed Card Component ---

function BedCard({ bed, name, onPress, isActive }) {
    return (
        <Pressable
            style={({ pressed }) => [
                styles.bedCard,
                isActive && styles.bedCardActive,
                pressed && styles.bedCardPressed,
            ]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`Bed ${bed}: ${name || 'unnamed'}${isActive ? ', active' : ''}`}
            accessibilityHint="Opens patient details"
            accessibilityState={{ selected: isActive }}
        >
            <SvgXml xml={isActive ? bedActiveSvg : bedSvg} width={43} height={43} />
            <View style={[styles.bedChip, isActive && styles.bedChipActive]}>
                <Text
                    style={[styles.bedChipText, isActive && styles.bedChipTextActive]}
                    numberOfLines={1}
                >
                    {`Bed ${bed}${name ? `: "${name}"` : ''}`}
                </Text>
            </View>
        </Pressable>
    );
}

// --- Pulsing mic button ---

function PulsingMicButton({ isRecording, disabled, onPress }) {
    const pulseScale   = useRef(new Animated.Value(1)).current;
    const pulseOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (isRecording) {
            pulseOpacity.setValue(0.45);
            const anim = Animated.loop(
                Animated.sequence([
                    Animated.parallel([
                        Animated.timing(pulseScale,   { toValue: 1.75, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
                        Animated.timing(pulseOpacity, { toValue: 0,    duration: 900, useNativeDriver: Platform.OS !== 'web' }),
                    ]),
                    Animated.parallel([
                        Animated.timing(pulseScale,   { toValue: 1,    duration: 0,   useNativeDriver: Platform.OS !== 'web' }),
                        Animated.timing(pulseOpacity, { toValue: 0.45, duration: 0,   useNativeDriver: Platform.OS !== 'web' }),
                    ]),
                ])
            );
            anim.start();
            return () => anim.stop();
        } else {
            pulseScale.setValue(1);
            pulseOpacity.setValue(0);
        }
    }, [isRecording]);

    return (
        <View style={styles.micButtonWrapper}>
            <Animated.View
                style={[
                    styles.pulseRing,
                    { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                ]}
                pointerEvents="none"
            />
            <TouchableOpacity
                style={[styles.micButton, isRecording && styles.micButtonRecording]}
                onPress={onPress}
                disabled={disabled}
                accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
            >
                <SvgXml xml={isRecording ? stopSvg : micSvg} width={24} height={24} />
            </TouchableOpacity>
            {isRecording && (
                <Text style={styles.recLabel}>Recording</Text>
            )}
        </View>
    );
}

// --- Screen ---

function DashboardScreen({ navigation, route }) {
  const [audioSource, setAudioSource] = useState({
    sourceKey: 'builtin',
    sourceLabel: 'Built-in mic',
    canToggle: false,
  });
  const [micStatus, setMicStatus] = useState('undetermined');
  const [beds, setBeds] = useState([]);
  const [bedsLoading, setBedsLoading] = useState(true);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [flushSyncing, setFlushSyncing] = useState(false);
  const [offlineGateVisible, setOfflineGateVisible] = useState(false);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [cleanupProgress, setCleanupProgress] = useState(false);
  // null → hidden; { success, failedItems, timestamp } → success or error view
  const [cleanupResult, setCleanupResult] = useState(null);
    const [activePatient, setActivePatient] = useState(null);
// true on native (always capable) and on Chrome; false on Firefox/Safari/Edge
    const [browserSupported, setBrowserSupported] = useState(true);
  // US23 — show a brief "shift resumed" banner when app relaunched into an active session
  const [resumedBanner, setResumedBanner] = useState(!!route?.params?.resumed);
  const [transcriptionSegments, setTranscriptionSegments] = useState([]);

  const { QueueNotifications } = useQueueNotifications();

  useEffect(() => {
    if (!resumedBanner) return;
    const t = setTimeout(() => setResumedBanner(false), 3500);
    return () => clearTimeout(t);
  }, []);

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
      setConfirmVisible,
      setFlushSyncing,
      setOfflineGateVisible,
      setUnsyncedCount,
      setCleanupProgress,
      setCleanupResult,
        setActivePatient,
        setBrowserSupported,
        setTranscriptionSegments,
    };
    const presenter = new DashboardPresenter(view);
    presenterRef.current = presenter;
    presenter.mount();
    return () => presenter.unmount();
  }, []);

  function handleEndShift() {
    presenterRef.current?.onEndShift(navigation);
  }

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
        <TouchableOpacity
          style={styles.endShiftButton}
          onPress={handleEndShift}
          accessibilityLabel="End shift"
          accessibilityHint="Ends your shift and permanently deletes all session data"
        >
          <SvgXml xml={endShiftSvg} width={24} height={24} />
          <Text style={styles.endShiftLabel}>End shift</Text>
        </TouchableOpacity>
      </View>


        {/* Chrome-only guard — shown on Firefox, Safari, Edge, etc. */}
        {!browserSupported && (
            <View style={styles.unsupportedBanner}>
                <Text style={styles.unsupportedText}>
                    Audio recording requires Google Chrome. Please open this page in Chrome to use this feature.
                </Text>
            </View>
        )}

      {/* US23 — shift resume indicator */}
      {resumedBanner && (
        <View style={styles.resumedBanner}>
          <Text style={styles.resumedBannerText}>Shift resumed — recording will continue automatically.</Text>
        </View>
      )}

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

      {/* Offline queue sync status — hidden when idle, non-blocking in all states */}
      <SyncStatusIndicator />

      {/* Offline queue notifications — transient toasts + persistent storage warning */}
      <QueueNotifications />

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
                isActive={activePatient?.id === item.id}
                onPress={() => presenterRef.current?.onBedPress(item, navigation)}
              />
            )}
          />
        )}
      </View>


        {/* US21 — active patient chip (shown above the bottom bar when a bed is selected) */}
        {activePatient && (
            <View style={styles.activePatientRow}>
                <View style={styles.activePatientChip}>
                    <Text style={styles.activePatientText} numberOfLines={1}>
                        {activePatient.bed ? `Bed ${activePatient.bed}` : 'New bed'}
                        {activePatient.name ? ` · ${activePatient.name}` : ''}
                    </Text>
                    <TouchableOpacity
                        style={styles.activePatientClearBtn}
                        onPress={() => presenterRef.current?.onClearActivePatient()}
                        accessibilityLabel="Clear active patient"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <SvgXml xml={closeSvg} width={16} height={16} />
                    </TouchableOpacity>
                </View>
            </View>
        )}

      {/* End Shift — confirmation dialog */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => presenterRef.current?.onEndShiftCancel()}
        accessibilityViewIsModal
      >
        <Pressable
          style={styles.dialogBackdrop}
          onPress={() => presenterRef.current?.onEndShiftCancel()}
        >
          <Pressable style={styles.dialogCard} onPress={() => {}}>
            <Text style={styles.dialogTitle}>End your shift?</Text>
            <Text style={styles.dialogBody}>
              All captured patient data will be permanently deleted from this device.
            </Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogBtnCancel]}
                onPress={() => presenterRef.current?.onEndShiftCancel()}
                accessibilityLabel="Cancel"
              >
                <Text style={styles.dialogBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogBtnConfirm]}
                onPress={() => presenterRef.current?.onEndShiftConfirmed(navigation)}
                accessibilityLabel="End shift"
              >
                <Text style={styles.dialogBtnConfirmText}>End shift</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* End Shift — syncing overlay (attempting queue flush) */}
      <Modal
        visible={flushSyncing}
        transparent
        animationType="fade"
        accessibilityViewIsModal
      >
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <ActivityIndicator size="large" color="#1D9E75" style={styles.syncSpinner} />
            <Text style={styles.dialogTitle}>Syncing pending data…</Text>
            <Text style={styles.dialogBody}>
              Uploading any unsynced recordings before clearing session data.
            </Text>
          </View>
        </View>
      </Modal>

      {/* End Shift — offline gate (sync failed, nurse chooses what to do) */}
      <Modal
        visible={offlineGateVisible}
        transparent
        animationType="fade"
        onRequestClose={() => presenterRef.current?.onOfflineGateWait()}
        accessibilityViewIsModal
      >
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Unsynced audio</Text>
            <Text style={styles.dialogBody}>
              {`${unsyncedCount} audio chunk${unsyncedCount !== 1 ? 's are' : ' is'} still unsynced. Wait to sync, or force delete (data will be lost).`}
            </Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogBtnCancel]}
                onPress={() => presenterRef.current?.onOfflineGateWait()}
                accessibilityLabel="Wait for sync to complete"
              >
                <Text style={styles.dialogBtnCancelText}>Wait</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogBtnConfirm]}
                onPress={() => presenterRef.current?.onOfflineGateForceDelete(navigation)}
                accessibilityLabel="Force delete — audio chunks will be lost"
              >
                <Text style={styles.dialogBtnConfirmText}>Force delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* End Shift — cleanup progress overlay */}
      <Modal
        visible={cleanupProgress}
        transparent
        animationType="fade"
        accessibilityViewIsModal
      >
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <ActivityIndicator size="large" color="#1D9E75" style={styles.syncSpinner} />
            <Text style={styles.dialogTitle}>Clearing session data…</Text>
            <Text style={styles.dialogBody}>
              Removing all patient records, recordings and transcriptions from this device.
            </Text>
          </View>
        </View>
      </Modal>

      {/* End Shift — success screen */}
      <Modal
        visible={cleanupResult?.success === true}
        transparent
        animationType="fade"
        accessibilityViewIsModal
      >
        <View style={styles.dialogBackdrop}>
          <View style={[styles.dialogCard, styles.resultCard]}>
            <SvgXml xml={checkCircleSvg} width={56} height={56} style={styles.resultIcon} />
            <Text style={styles.dialogTitle}>Shift ended</Text>
            <Text style={styles.dialogBody}>All data cleared.</Text>
            {cleanupResult?.timestamp ? (
              <Text style={styles.resultTimestamp}>
                {new Date(cleanupResult.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </Text>
            ) : null}
            <TouchableOpacity
              style={[styles.dialogBtn, styles.dialogBtnConfirm, styles.resultDoneBtn]}
              onPress={() => presenterRef.current?.onSuccessDismiss(navigation)}
              accessibilityLabel="Done"
            >
              <Text style={styles.dialogBtnConfirmText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* End Shift — error screen */}
      <Modal
        visible={cleanupResult !== null && cleanupResult.success === false}
        transparent
        animationType="fade"
        accessibilityViewIsModal
      >
        <View style={styles.dialogBackdrop}>
          <View style={[styles.dialogCard, styles.resultCard]}>
            <SvgXml xml={warningTriangleSvg} width={56} height={56} style={styles.resultIcon} />
            <Text style={styles.dialogTitle}>Cleanup incomplete</Text>
            <Text style={styles.dialogBody}>
              The following items could not be deleted. Tap Retry to try again.
            </Text>
            <View style={styles.failedList}>
              {(cleanupResult?.failedItems ?? []).map((item, i) => (
                <View key={i} style={styles.failedRow}>
                  <Text style={styles.failedRowText} numberOfLines={2}>{item}</Text>
                </View>
              ))}
            </View>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogBtnCancel]}
                onPress={() => presenterRef.current?.onCleanupErrorDismiss()}
                accessibilityLabel="Cancel"
              >
                <Text style={styles.dialogBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, styles.dialogBtnConfirm]}
                onPress={() => presenterRef.current?.onRetryCleanup(navigation)}
                accessibilityLabel="Retry cleanup"
              >
                <Text style={styles.dialogBtnConfirmText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Bottom action bar — US7 */}
      <View style={styles.bottomBar}>
        <View style={styles.barItem}>
          <MicInputIcon sourceKey={audioSource.sourceKey} />
          <Text style={styles.barLabel} numberOfLines={1}>{audioSource.sourceLabel}</Text>
        </View>

          <PulsingMicButton
              isRecording={isRecording}
              disabled={micStatus === 'blocked' || !browserSupported}
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
  endShiftButton: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  endShiftLabel: {
    fontSize: 10,
    color: '#A32D2D',
    marginTop: 2,
    fontWeight: '500',
  },

    // ─── US23 shift-resumed banner ──────────────────────────
    resumedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#E8F7F2',
        borderWidth: 0.5,
        borderColor: '#1D9E75',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginHorizontal: 16,
        marginTop: 8,
    },
    resumedBannerText: {
        flex: 1,
        fontSize: 13,
        color: '#145C44',
        lineHeight: 18,
    },

    // ─── Unsupported browser banner ─────────────────────────
    unsupportedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF8EC',
        borderWidth: 0.5,
        borderColor: '#E8A838',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginHorizontal: 16,
        marginTop: 8,
    },
    unsupportedText: {
        flex: 1,
        fontSize: 13,
        color: '#7A4B00',
        lineHeight: 18,
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
    // US21 — active bed highlight
    bedCardActive: {
        opacity: 1,
    },
    bedCardPressed: {
        backgroundColor: '#E8F7F2',
        borderRadius: 8,
        opacity: 0.85,
    },
  bedChip: {
    borderWidth: 1,
    borderColor: '#CAC4D0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 4,
  },
    bedChipActive: {
        borderColor: '#1D9E75',
        backgroundColor: '#E8F7F2',
    },
  bedChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1D1B20',
    textAlign: 'center',
  },
    bedChipTextActive: {
        color: '#1D9E75',
    },
    // ─── US21 active patient chip ────────────────────────────
    activePatientRow: {
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderTopWidth: 0.5,
        borderTopColor: '#D3D1C7',
    },
    activePatientChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#E8F7F2',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#1D9E75',
        paddingHorizontal: 14,
        paddingVertical: 6,
        gap: 8,
        maxWidth: '80%',
    },
    activePatientText: {
        fontSize: 13,
        fontWeight: '500',
        color: '#1D9E75',
        flexShrink: 1,
    },
    activePatientClearBtn: {
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
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
  barItem: { flex: 1, alignItems: 'center', gap: 4 },
  barItemDisabled: { opacity: 0.4 },
  barLabel: { fontSize: 10, color: '#5F5E5A' },
  barLabelDisabled: { color: '#B4B2A9' },
    micButtonWrapper: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    pulseRing: {
        position: 'absolute',
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: '#A32D2D',
    },
  micButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonRecording: { backgroundColor: '#A32D2D' },
    recLabel: {
        fontSize: 10,
        color: '#A32D2D',
        fontWeight: '600',
        marginTop: 4,
        letterSpacing: 0.5,
    },
  speakerPlaceholder: { width: 24, height: 24, borderRadius: 4, backgroundColor: '#B4B2A9' },
  // ─── End Shift dialog ────────────────────────────────────
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
    width: '82%',
    maxWidth: 360,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  syncSpinner: {
    marginBottom: 16,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1D1B20',
    marginBottom: 10,
  },
  dialogBody: {
    fontSize: 14,
    color: '#5F5E5A',
    lineHeight: 20,
    marginBottom: 24,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  dialogBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  dialogBtnCancel: {
    borderWidth: 1,
    borderColor: '#CAC4D0',
  },
  dialogBtnCancelText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1D1B20',
  },
  dialogBtnConfirm: {
    backgroundColor: '#A32D2D',
  },
  dialogBtnConfirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // ─── Cleanup result (success / error) ────────────────────
  resultCard: {
    alignItems: 'center',
  },
  resultIcon: {
    marginBottom: 16,
  },
  resultTimestamp: {
    fontSize: 13,
    color: '#767676',
    marginTop: -8,
    marginBottom: 24,
  },
  resultDoneBtn: {
    alignSelf: 'stretch',
    marginTop: 8,
    backgroundColor: '#1D9E75',
  },
  failedList: {
    alignSelf: 'stretch',
    marginBottom: 20,
    gap: 8,
  },
  failedRow: {
    backgroundColor: '#FEF3EE',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  failedRowText: {
    fontSize: 13,
    color: '#C45C2E',
    lineHeight: 18,
  },
});

export default DashboardScreen;
