import React, { useEffect, useRef, useState } from 'react';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import CardDetailPresenter from '../presenters/CardDetailPresenter';
import { AudioSourceBadge } from './AudioSourceBadge';

// ─── SVG icons ────────────────────────────────────────────────────────────────

const arrowBackSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#1D1B20"/>
</svg>`;

const patientBedSvg = `<svg width="32" height="32" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 32V12H8V24H28V16H40C42.2 16 44 17.8 44 20V32H40V28H8V32H4ZM14 22C11.8 22 10 20.2 10 18C10 15.8 11.8 14 14 14C16.2 14 18 15.8 18 18C18 20.2 16.2 22 14 22Z" fill="#1D9E75"/>
</svg>`;

const editPencilSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 17.25V21H6.75L17.81 9.94L14.06 6.19L3 17.25ZM20.71 7.04C21.1 6.65 21.1 6.02 20.71 5.63L18.37 3.29C17.98 2.9 17.35 2.9 16.96 3.29L15.13 5.12L18.88 8.87L20.71 7.04Z" fill="#5F5E5A"/>
</svg>`;

const copySvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z" fill="#5F5E5A"/>
</svg>`;

// ─── Card type → display label ────────────────────────────────────────────────

const CARD_TYPE_LABEL = {
    recent_activity: 'Clinical Activity',
    next_reminder:   'Next Reminder',
    vital_signs:     'Vital Signs',
    medications:     'Medications',
    allergies:       'Allergies',
    safety_info:     'Safety Information',
};

// ─── Type-specific content components ────────────────────────────────────────

function VitalSignsContent({ data }) {
    if (!data) return <Text style={styles.emptyText}>No vital signs recorded.</Text>;
    const rows = [
        { label: 'Blood Pressure', value: data.blood_pressure, unit: 'mmHg' },
        { label: 'Heart Rate',     value: data.heart_rate,     unit: 'bpm'  },
        { label: 'Temperature',    value: data.temperature,    unit: '°C'   },
        { label: 'SpO2',           value: data.spo2,           unit: '%'    },
    ].filter((r) => r.value != null);
    if (rows.length === 0) return <Text style={styles.emptyText}>No vital signs recorded.</Text>;
    return (
        <>
            {rows.map((r, i) => (
                <View key={i} style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{r.label}</Text>
                    <Text style={styles.fieldValue}>{r.value} <Text style={styles.fieldUnit}>{r.unit}</Text></Text>
                </View>
            ))}
        </>
    );
}

function ReminderContent({ items }) {
    if (!Array.isArray(items) || items.length === 0)
        return <Text style={styles.emptyText}>No reminders recorded.</Text>;
    return (
        <>
            {items.map((item, i) => (
                <View key={i} style={styles.listRow}>
                    <Text style={styles.listBullet}>•</Text>
                    <Text style={styles.listText}>{item}</Text>
                </View>
            ))}
        </>
    );
}

function MedicationsContent({ items }) {
    if (!Array.isArray(items) || items.length === 0)
        return <Text style={styles.emptyText}>No medications recorded.</Text>;
    return (
        <>
            {items.map((med, i) => {
                const name = med.medication_name || med.name || '—';
                let dueTime = null;
                try {
                    if (med.next_due) {
                        const d = new Date(med.next_due);
                        if (!isNaN(d)) dueTime = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    }
                } catch (_) {}
                return (
                    <View key={i} style={styles.blockRow}>
                        <Text style={styles.blockTitle}>{name}</Text>
                        {med.dose      ? <Text style={styles.blockDetail}>Dose: {med.dose}</Text>          : null}
                        {med.frequency ? <Text style={styles.blockDetail}>Frequency: {med.frequency}</Text> : null}
                        {dueTime       ? <Text style={styles.blockDetail}>Next due: {dueTime}</Text>        : null}
                    </View>
                );
            })}
        </>
    );
}

function AllergiesContent({ items }) {
    if (!Array.isArray(items) || items.length === 0)
        return <Text style={styles.emptyText}>No allergies recorded.</Text>;
    return (
        <>
            {items.map((a, i) => (
                <View key={i} style={styles.blockRow}>
                    <Text style={styles.blockTitle}>{a.allergen}</Text>
                    {a.reaction_type ? <Text style={styles.blockDetail}>Reaction: {a.reaction_type}</Text> : null}
                    {a.severity      ? <Text style={styles.blockDetail}>Severity: {a.severity}</Text>      : null}
                </View>
            ))}
        </>
    );
}

function CardContent({ card, narrative, editedValue }) {
    if (editedValue != null) {
        return <NarrativeContent narrative={{ transcript: editedValue, sections: null }} />;
    }
    switch (card?.type) {
        case 'recent_activity': return <TranscriptionContent segments={card.segments} narrative={narrative} />;
        case 'vital_signs':     return <VitalSignsContent    data={card.data}  />;
        case 'next_reminder':   return <ReminderContent      items={card.items} />;
        case 'medications':     return <MedicationsContent   items={card.items} />;
        case 'allergies':       return <AllergiesContent     items={card.items} />;
        default:                return <NarrativeContent     narrative={narrative} />;
    }
}

// ─── TranscriptionContent ─────────────────────────────────────────────────────

function TranscriptionContent({ segments, narrative }) {
    if (Array.isArray(segments) && segments.length > 0) {
        return (
            <>
                {segments.map((seg, i) => {
                    const time = seg.ts_start
                        ? new Date(seg.ts_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : null;
                    return (
                        <View key={i} style={styles.segmentRow}>
                            {time ? <Text style={styles.segmentTime}>{time}</Text> : null}
                            <Text style={styles.transcriptText}>{seg.transcript}</Text>
                        </View>
                    );
                })}
            </>
        );
    }
    return <NarrativeContent narrative={narrative} />;
}

// ─── NarrativeContent ─────────────────────────────────────────────────────────

function NarrativeContent({ narrative }) {
    const { sections, transcript } = narrative;

    if (Array.isArray(sections) && sections.length > 0) {
        return (
            <>
                {sections.map((s, i) => (
                    <View key={i} style={styles.section}>
                        <Text style={styles.sectionHeader}>{s.header}</Text>
                        <Text style={styles.sectionBody}>{s.body}</Text>
                    </View>
                ))}
            </>
        );
    }

    if (transcript) {
        return <Text style={styles.transcriptText}>{transcript}</Text>;
    }

    return <Text style={styles.emptyText}>No narrative available.</Text>;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

function CardDetailScreen({ route, navigation }) {
    const { card, patient } = route.params ?? {};

    const [audioSource, setAudioSource] = useState({
        sourceKey: 'builtin',
        sourceLabel: 'Built-in mic',
        canToggle: false,
    });
    const [metadata, setMetadata]           = useState({ timeLabel: 'Today –', language: '–' });
    const [narrative, setNarrative]         = useState({ transcript: null, sections: null });
    const [copyToastVisible, setCopyToastVisible] = useState(false);
    const [isEdited, setIsEdited]           = useState(false);
    const [editedValue, setEditedValue]     = useState(null);

    const presenterRef = useRef(null);

    useEffect(() => {
        const view = {
            setAudioSource,
            setMetadata,
            setNarrative,
            setIsEdited,
            setEditedValue,
            showCopyToast: () => {
                setCopyToastVisible(true);
                setTimeout(() => setCopyToastVisible(false), 2000);
            },
        };
        const presenter = new CardDetailPresenter(view);
        presenterRef.current = presenter;
        presenter.mount({ card, patient, navigation });
        return () => presenter.unmount();
    }, []);

    // Re-check edit status each time this screen comes back into focus
    // (e.g. after the nurse saves from EditPatientScreen).
    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            presenterRef.current?.checkEditStatus();
        });
        return unsubscribe;
    }, [navigation]);

    const patientLabel = patient?.bed
        ? `Bed ${patient.bed}${patient?.name ? `: '${patient.name}'` : ''}`
        : 'Patient';

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
                    <Text style={styles.headerTitle} numberOfLines={1}>
                        {card?.activityType ?? CARD_TYPE_LABEL[card?.type] ?? 'Clinical Activity'}
                    </Text>
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
            <Text style={styles.patientId}>{patientLabel}</Text>

            {/* Metadata bar */}
            <View style={styles.metaBar}>
                <View style={styles.metaLeft}>
                    <Text style={styles.metaText}>{metadata.timeLabel}</Text>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={styles.metaText}>Language: {metadata.language}</Text>
                </View>
                <View style={styles.metaRight}>
                    <View style={styles.editBtnWrapper}>
                        <TouchableOpacity
                            style={styles.metaIconBtn}
                            onPress={() => presenterRef.current?.onEditPress()}
                            accessibilityLabel="Edit"
                        >
                            <SvgXml xml={editPencilSvg} width={20} height={20} />
                        </TouchableOpacity>
                        {isEdited && <View style={styles.editedDot} />}
                    </View>
                    <TouchableOpacity
                        style={styles.metaIconBtn}
                        onPress={() => presenterRef.current?.onCopyPress()}
                        accessibilityLabel="Copy to clipboard"
                    >
                        <SvgXml xml={copySvg} width={20} height={20} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Card content */}
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                <CardContent card={card} narrative={narrative} editedValue={editedValue} />
            </ScrollView>

            {/* Copy toast */}
            {copyToastVisible && (
                <View style={styles.toast} pointerEvents="none">
                    <Text style={styles.toastText}>Copied to clipboard</Text>
                </View>
            )}

        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    // ─── Header ───────────────────────────────────────────────
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
        flexShrink: 1,
    },
    headerSpacer: {
        width: 48,
    },
    // ─── Source badge ──────────────────────────────────────────
    sourceRow: {
        alignItems: 'center',
        paddingTop: 10,
    },
    // ─── Patient identifier ────────────────────────────────────
    patientId: {
        fontSize: 15,
        fontWeight: '500',
        color: '#1D1B20',
        textAlign: 'center',
        marginTop: 6,
        paddingHorizontal: 16,
    },
    // ─── Metadata bar ──────────────────────────────────────────
    metaBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F7F7F7',
        paddingHorizontal: 12,
        paddingVertical: 4,
        marginTop: 10,
        borderTopWidth: 0.5,
        borderBottomWidth: 0.5,
        borderColor: '#E4E2DE',
    },
    metaLeft: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
    },
    metaText: {
        fontSize: 12,
        color: '#5F5E5A',
    },
    metaDot: {
        fontSize: 12,
        color: '#B4B2A9',
    },
    metaRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    metaIconBtn: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Wrapper for edit button + edited indicator dot
    editBtnWrapper: {
        position: 'relative',
    },
    // Orange dot shown when the nurse has manually edited this field
    editedDot: {
        position:     'absolute',
        top:          8,
        right:        8,
        width:        8,
        height:       8,
        borderRadius: 4,
        backgroundColor: '#F08C00',
    },
    // ─── Narrative ─────────────────────────────────────────────
    scroll: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 32,
    },
    section: {
        marginBottom: 20,
    },
    sectionHeader: {
        fontSize: 12,
        fontWeight: '700',
        color: '#5F5E5A',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginBottom: 6,
    },
    sectionBody: {
        fontSize: 15,
        color: '#1D1B20',
        lineHeight: 23,
    },
    transcriptText: {
        fontSize: 15,
        color: '#1D1B20',
        lineHeight: 23,
    },
    emptyText: {
        fontSize: 14,
        color: '#767676',
        textAlign: 'center',
        marginTop: 40,
        lineHeight: 20,
    },
    // ─── Transcription segments ────────────────────────────────
    segmentRow: {
        marginBottom: 16,
    },
    segmentTime: {
        fontSize: 11,
        color: '#B4B2A9',
        marginBottom: 3,
    },
    // ─── Structured content ────────────────────────────────────
    fieldRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 0.5,
        borderBottomColor: '#E4E2DE',
    },
    fieldLabel: {
        fontSize: 14,
        color: '#5F5E5A',
        fontWeight: '500',
    },
    fieldValue: {
        fontSize: 16,
        color: '#1D1B20',
        fontWeight: '600',
    },
    fieldUnit: {
        fontSize: 13,
        color: '#5F5E5A',
        fontWeight: '400',
    },
    listRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 12,
        gap: 10,
    },
    listBullet: {
        fontSize: 16,
        color: '#1D9E75',
        lineHeight: 23,
    },
    listText: {
        flex: 1,
        fontSize: 15,
        color: '#1D1B20',
        lineHeight: 23,
    },
    blockRow: {
        marginBottom: 16,
        paddingBottom: 16,
        borderBottomWidth: 0.5,
        borderBottomColor: '#E4E2DE',
    },
    blockTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1D1B20',
        marginBottom: 4,
    },
    blockDetail: {
        fontSize: 14,
        color: '#5F5E5A',
        lineHeight: 21,
    },
    // ─── Copy toast ────────────────────────────────────────────
    toast: {
        position: 'absolute',
        bottom: 36,
        alignSelf: 'center',
        backgroundColor: 'rgba(0,0,0,0.72)',
        borderRadius: 20,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    toastText: {
        fontSize: 13,
        color: '#FFFFFF',
        fontWeight: '500',
    },
});

export default CardDetailScreen;