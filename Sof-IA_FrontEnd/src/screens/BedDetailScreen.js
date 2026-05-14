import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    FlatList,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import PatientDetailsPresenter from '../presenters/PatientDetailsPresenter';
import { AudioSourceBadge, MicInputIcon } from './AudioSourceBadge';
import { useRecordingContext } from '../contexts/RecordingContext';

// ─── SVG icons ────────────────────────────────────────────────────────────────

const arrowBackSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#1D1B20"/>
</svg>`;

const patientBedSvg = `<svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 32V12H8V24H28V16H40C42.2 16 44 17.8 44 20V32H40V28H8V32H4ZM14 22C11.8 22 10 20.2 10 18C10 15.8 11.8 14 14 14C16.2 14 18 15.8 18 18C18 20.2 16.2 22 14 22Z" fill="#1D9E75"/>
</svg>`;

const shieldSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2L4 5V11C4 16.55 7.84 21.74 12 23C16.16 21.74 20 16.55 20 11V5L12 2Z" fill="#1D9E75"/>
</svg>`;

const clockSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M11.99 2C6.47 2 2 6.48 2 12C2 17.52 6.47 22 11.99 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 11.99 2ZM12 20C7.58 20 4 16.42 4 12C4 7.58 7.58 4 12 4C16.42 4 20 7.58 20 12C20 16.42 16.42 20 12 20ZM12.5 7H11V13L16.25 16.15L17 14.92L12.5 12.25V7Z" fill="#5F5E5A"/>
</svg>`;

const pillSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4.22 11.29L11.29 4.22C12.78 2.73 15.19 2.73 16.68 4.22L19.78 7.32C21.27 8.81 21.27 11.22 19.78 12.71L12.71 19.78C11.22 21.27 8.81 21.27 7.32 19.78L4.22 16.68C2.73 15.19 2.73 12.78 4.22 11.29ZM15.27 5.63C14.56 4.92 13.41 4.92 12.7 5.63L9 9.34L14.66 15L18.37 11.29C19.08 10.58 19.08 9.43 18.37 8.73L15.27 5.63Z" fill="#5F5E5A"/>
</svg>`;

const bellSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 22C13.1 22 14 21.1 14 20H10C10 21.1 10.9 22 12 22ZM18 16V11C18 7.93 16.37 5.36 13.5 4.68V4C13.5 3.17 12.83 2.5 12 2.5C11.17 2.5 10.5 3.17 10.5 4V4.68C7.64 5.36 6 7.92 6 11V16L4 18V19H20V18L18 16Z" fill="#5F5E5A"/>
</svg>`;

const heartSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 21.35L10.55 20.03C5.4 15.36 2 12.27 2 8.5C2 5.41 4.42 3 7.5 3C9.24 3 10.91 3.81 12 5.08C13.09 3.81 14.76 3 16.5 3C19.58 3 22 5.41 22 8.5C22 12.27 18.6 15.36 13.45 20.03L12 21.35Z" fill="#E05A5A"/>
</svg>`;

const warningSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 21H23L12 2L1 21ZM13 18H11V16H13V18ZM13 14H11V10H13V14Z" fill="#E8A838"/>
</svg>`;

const infoSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V11H13V17ZM13 9H11V7H13V9Z" fill="#5F5E5A"/>
</svg>`;

const eyeSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 4.5C7 4.5 2.73 7.61 1 12C2.73 16.39 7 19.5 12 19.5C17 19.5 21.27 16.39 23 12C21.27 7.61 17 4.5 12 4.5ZM12 17C9.24 17 7 14.76 7 12C7 9.24 9.24 7 12 7C14.76 7 17 9.24 17 12C17 14.76 14.76 17 12 17ZM12 9C10.34 9 9 10.34 9 12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12C15 10.34 13.66 9 12 9Z" fill="#1D9E75"/>
</svg>`;

const chevronRightSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8.59 16.59L13.17 12L8.59 7.41L10 6L16 12L10 18L8.59 16.59Z" fill="#B4B2A9"/>
</svg>`;

const micSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 14C13.66 14 15 12.66 15 11V5C15 3.34 13.66 2 12 2C10.34 2 9 3.34 9 5V11C9 12.66 10.34 14 12 14ZM17.91 11C17.42 13.84 14.97 16 12 16C9.03 16 6.58 13.84 6.09 11H4.07C4.57 14.55 7.25 17.44 10.75 17.91V21H13.25V17.91C16.75 17.44 19.43 14.55 19.93 11H17.91Z" fill="white"/>
</svg>`;

const stopSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="6" width="12" height="12" rx="2" fill="white"/>
</svg>`;

// ─── Icon map ──────────────────────────────────────────────────────────────────

const CARD_ICONS = {
    recent_activity: clockSvg,
    medications:     pillSvg,
    next_reminder:   bellSvg,
    vital_signs:     heartSvg,
    allergies:       warningSvg,
    safety_info:     infoSvg,
};

const CARD_TITLES = {
    recent_activity: 'Recent Activity',
    medications:     'Medications',
    next_reminder:   'Next Reminder',
    vital_signs:     'Vital Signs',
    allergies:       'Allergies',
    safety_info:     'Safety Information',
};

// ─── SessionActiveCard ────────────────────────────────────────────────────────

function SessionActiveCard({ startedAt, expiresAt }) {
    const fmt = (iso) =>
        iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

    return (
        <View style={styles.sessionCard}>
            <View style={styles.cardHeader}>
                <SvgXml xml={shieldSvg} width={20} height={20} />
                <Text style={styles.cardTitle}>Session Active</Text>
            </View>
            <Text style={styles.sessionBody}>
                Started: {fmt(startedAt)}{'  ·  '}Expires: {fmt(expiresAt)}
            </Text>
        </View>
    );
}

// ─── InfoCard ─────────────────────────────────────────────────────────────────

function InfoCard({ card, onPress }) {
    const anim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(anim, {
            toValue: 1,
            duration: 280,
            useNativeDriver: Platform.OS !== 'web',
        }).start();
    }, []);

    const iconSvg = CARD_ICONS[card.type] ?? infoSvg;
    const title   = CARD_TITLES[card.type] ?? card.type;

    const cardBg = card.flagged ? styles.cardFlagged : styles.cardNormal;
    const statusIcon = card.hasData && !card.flagged
        ? <SvgXml xml={eyeSvg} width={16} height={16} />
        : card.flagged
            ? <SvgXml xml={warningSvg} width={16} height={16} />
            : null;

    return (
        <Animated.View
            style={{
                opacity: anim,
                transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
            }}
        >
            <TouchableOpacity
                style={[styles.infoCard, cardBg]}
                onPress={() => onPress(card)}
                activeOpacity={0.75}
                accessibilityLabel={title}
            >
                <View style={styles.cardHeader}>
                    <SvgXml xml={iconSvg} width={20} height={20} />
                    <Text style={styles.cardTitle}>{title}</Text>
                    {statusIcon && (
                        <View style={styles.statusIcon}>{statusIcon}</View>
                    )}
                </View>
                {!!card.preview && (
                    <Text style={styles.cardPreview} numberOfLines={1}>
                        {card.preview}
                    </Text>
                )}
                {card.type === 'recent_activity' && !!card.transcript && (
                    <View style={styles.transcriptBox}>
                        <Text style={styles.transcriptText} numberOfLines={4}>
                            {card.transcript}
                        </Text>
                    </View>
                )}
            </TouchableOpacity>
        </Animated.View>
    );
}

// ─── PulsingMicButton (same as DashboardScreen) ───────────────────────────────

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
                style={[styles.pulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]}
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
            {isRecording && <Text style={styles.recLabel}>Recording</Text>}
        </View>
    );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function BedDetailScreen({ route, navigation }) {
    const { patient, sessionId = null } = route.params ?? {};

    const [audioSource, setAudioSource] = useState({ sourceKey: 'builtin', sourceLabel: 'Built-in mic', canToggle: false });
    const [browserSupported, setBrowserSupported] = useState(true);
    const [sessionCard, setSessionCard] = useState(null);
    const [cards, setCards] = useState([]);

    const { isRecording, setIsRecording, setConnectionStatus } = useRecordingContext();

    const presenterRef = useRef(null);

    useEffect(() => {
        const view = {
            setAudioSource,
            setRecording: setIsRecording,
            setConnectionStatus,
            setBrowserSupported,
            setSessionCard,
            setCards,
        };
        const presenter = new PatientDetailsPresenter(view);
        presenterRef.current = presenter;
        presenter.mount({ patient, sessionId });
        return () => presenter.unmount();
    }, []);

    return (
        <SafeAreaView style={styles.container}>

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                    accessibilityLabel="Go back"
                >
                    <SvgXml xml={arrowBackSvg} width={24} height={24} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <SvgXml xml={patientBedSvg} width={32} height={32} />
                    <Text style={styles.headerTitle}>What do I know</Text>
                </View>
                <View style={styles.headerSpacer} />
            </View>

            {/* Audio source badge */}
            <View style={styles.sourceRow}>
                <AudioSourceBadge
                    sourceKey={audioSource.sourceKey}
                    sourceLabel={audioSource.sourceLabel}
                    canToggle={audioSource.canToggle}
                    onPress={() => presenterRef.current?.onToggleSource()}
                />
            </View>

            {/* Patient identifier */}
            <Text style={styles.patientId}>
                {patient?.bed ? `Bed ${patient.bed}` : 'Patient'}
                {patient?.name ? `: '${patient.name}'` : ''}
            </Text>

            {/* Card list */}
            <FlatList
                style={{ flex: 1 }}
                data={cards}
                keyExtractor={(item) => item.type}
                contentContainerStyle={styles.cardList}
                ListHeaderComponent={
                    sessionCard ? (
                        <SessionActiveCard
                            startedAt={sessionCard.startedAt}
                            expiresAt={sessionCard.expiresAt}
                        />
                    ) : null
                }
                ListEmptyComponent={
                    <Text style={styles.emptyText}>
                        No information extracted yet. Start recording to capture patient data.
                    </Text>
                }
                renderItem={({ item }) => (
                    <InfoCard
                        card={item}
                        onPress={(card) => presenterRef.current?.onCardPress(card, navigation)}
                    />
                )}
            />

            {/* Bottom bar */}
            <View style={styles.bottomBar}>
                <View style={styles.barItem}>
                    <MicInputIcon sourceKey={audioSource.sourceKey} />
                    <Text style={styles.barLabel} numberOfLines={1}>{audioSource.sourceLabel}</Text>
                </View>

                <PulsingMicButton
                    isRecording={isRecording}
                    disabled={!browserSupported}
                    onPress={() => presenterRef.current?.onMicPress()}
                />

                <View style={[styles.barItem, styles.barItemDisabled]}>
                    <View style={styles.speakerPlaceholder} />
                    <Text style={[styles.barLabel, styles.barLabelDisabled]}>AI volume</Text>
                </View>
            </View>

        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    // ─── Header ──────────────────────────────────────────────
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 64,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#CAC4D0',
    },
    backButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerCenter: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1D1B20',
    },
    headerSpacer: {
        width: 48,
    },
    // ─── Source badge ─────────────────────────────────────────
    sourceRow: {
        alignItems: 'center',
        paddingTop: 10,
    },
    // ─── Patient identifier ───────────────────────────────────
    patientId: {
        fontSize: 15,
        fontWeight: '500',
        color: '#1D1B20',
        textAlign: 'center',
        marginTop: 6,
        marginBottom: 12,
        paddingHorizontal: 16,
    },
    // ─── Cards ────────────────────────────────────────────────
    cardList: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        gap: 12,
    },
    sessionCard: {
        backgroundColor: '#F5F5F5',
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
    },
    infoCard: {
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E4E2DE',
    },
    cardNormal: {
        backgroundColor: '#FAFAFA',
    },
    cardFlagged: {
        backgroundColor: '#FFFBEC',
        borderColor: '#E8A838',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    cardTitle: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: '#1D1B20',
    },
    statusIcon: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sessionBody: {
        fontSize: 13,
        color: '#5F5E5A',
        marginTop: 6,
    },
    cardPreview: {
        fontSize: 12,
        color: '#767676',
        marginTop: 4,
        lineHeight: 17,
    },
    transcriptBox: {
        marginTop: 8,
        backgroundColor: '#F0FAF6',
        borderLeftWidth: 3,
        borderLeftColor: '#1D9E75',
        borderRadius: 4,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    transcriptText: {
        fontSize: 13,
        color: '#1D1B20',
        lineHeight: 19,
        fontStyle: 'italic',
    },
    emptyText: {
        fontSize: 14,
        color: '#767676',
        textAlign: 'center',
        marginTop: 32,
        paddingHorizontal: 16,
        lineHeight: 20,
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
    barItem: {
        flex: 1,
        alignItems: 'center',
        gap: 4,
    },
    barItemDisabled: {
        opacity: 0.4,
    },
    barLabel: {
        fontSize: 10,
        color: '#5F5E5A',
    },
    barLabelDisabled: {
        color: '#B4B2A9',
    },
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
    micButtonRecording: {
        backgroundColor: '#A32D2D',
    },
    recLabel: {
        fontSize: 10,
        color: '#A32D2D',
        fontWeight: '600',
        marginTop: 4,
        letterSpacing: 0.5,
    },
    speakerPlaceholder: {
        width: 24,
        height: 24,
        borderRadius: 4,
        backgroundColor: '#B4B2A9',
    },
});

export default BedDetailScreen;