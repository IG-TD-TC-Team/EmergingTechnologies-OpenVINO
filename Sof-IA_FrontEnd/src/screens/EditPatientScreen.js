import React, { useEffect, useRef, useState } from 'react';
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import EditPatientPresenter from '../presenters/EditPatientPresenter';

// ─── SVG icons ────────────────────────────────────────────────────────────────

const arrowBackSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 11H7.83L13.42 5.41L12 4L4 12L12 20L13.41 18.59L7.83 13H20V11Z" fill="#1D1B20"/>
</svg>`;

const deleteSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 19C6 20.1 6.9 21 8 21H16C17.1 21 18 20.1 18 19V7H6V19ZM19 4H15.5L14.5 3H9.5L8.5 4H5V6H19V4Z" fill="#B3261E"/>
</svg>`;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function EditPatientScreen({ route, navigation }) {
    const { patientId, fieldKey, currentValue } = route.params ?? {};

    const [fieldLabel, setFieldLabel]         = useState(fieldKey ?? '');
    const [value, setValue]                   = useState(
        currentValue != null ? String(currentValue) : ''
    );
    const [isEdited, setIsEdited]             = useState(false);
    const [originalValue, setOriginalValue]   = useState(null);
    const [isSaving, setIsSaving]             = useState(false);
    const [error, setError]                   = useState(null);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const presenterRef = useRef(null);

    useEffect(() => {
        const view = {
            setFieldLabel,
            setCurrentValue:   setValue,
            setIsEdited,
            setOriginalValue,
            setIsSaving,
            showError:         setError,
            showDeleteConfirm: () => setShowDeleteDialog(true),
        };
        const presenter = new EditPatientPresenter(view);
        presenterRef.current = presenter;
        presenter.mount({ patientId, fieldKey, currentValue, navigation });
    }, []);

    const handleSave = () => {
        setError(null);
        presenterRef.current?.onSave(value);
    };

    const handleDeleteConfirm = () => {
        setShowDeleteDialog(false);
        presenterRef.current?.onDeleteConfirm();
    };

    return (
        <SafeAreaView style={styles.container}>

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => presenterRef.current?.onCancel()}
                    accessibilityLabel="Cancel"
                >
                    <SvgXml xml={arrowBackSvg} width={24} height={24} />
                </TouchableOpacity>
                <Text style={styles.headerTitle} numberOfLines={1}>
                    Edit {fieldLabel}
                </Text>
                <View style={styles.headerSpacer} />
            </View>

            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Field label + edited badge */}
                    <View style={styles.fieldLabelRow}>
                        <Text style={styles.fieldLabelText}>{fieldLabel}</Text>
                        {isEdited && (
                            <View style={styles.editedBadge}>
                                <Text style={styles.editedBadgeText}>Edited</Text>
                            </View>
                        )}
                    </View>

                    {/* AI-captured value shown as audit trail when field was edited */}
                    {isEdited && originalValue != null && (
                        <View style={styles.originalRow}>
                            <Text style={styles.originalLabel}>AI captured: </Text>
                            <Text style={styles.originalValue} numberOfLines={3}>
                                {originalValue}
                            </Text>
                        </View>
                    )}

                    {/* Editable input */}
                    <TextInput
                        style={[styles.input, isEdited && styles.inputEdited]}
                        value={value}
                        onChangeText={setValue}
                        multiline
                        autoFocus
                        textAlignVertical="top"
                        placeholder={`Enter ${fieldLabel.toLowerCase()}…`}
                        placeholderTextColor="#B4B2A9"
                        accessibilityLabel={fieldLabel}
                    />

                    {/* Inline error */}
                    {error != null && (
                        <Text style={styles.errorText}>{error}</Text>
                    )}

                    {/* Save / Cancel */}
                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={styles.cancelBtn}
                            onPress={() => presenterRef.current?.onCancel()}
                            accessibilityLabel="Cancel"
                        >
                            <Text style={styles.cancelBtnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
                            onPress={handleSave}
                            disabled={isSaving}
                            accessibilityLabel="Save"
                        >
                            <Text style={styles.saveBtnText}>
                                {isSaving ? 'Saving…' : 'Save'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Delete button — separated at the bottom */}
            <View style={styles.deleteSection}>
                <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => presenterRef.current?.onDeletePress()}
                    accessibilityLabel="Delete this record"
                >
                    <SvgXml xml={deleteSvg} width={20} height={20} />
                    <Text style={styles.deleteBtnText}>Delete this record</Text>
                </TouchableOpacity>
            </View>

            {/* Delete confirmation modal */}
            <Modal
                visible={showDeleteDialog}
                transparent
                animationType="fade"
                onRequestClose={() => setShowDeleteDialog(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalBox}>
                        <Text style={styles.modalTitle}>Delete Record?</Text>
                        <Text style={styles.modalBody}>
                            This will permanently delete this patient record.
                            This action cannot be undone.
                        </Text>
                        <View style={styles.modalActions}>
                            <TouchableOpacity
                                style={styles.modalCancelBtn}
                                onPress={() => setShowDeleteDialog(false)}
                            >
                                <Text style={styles.modalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.modalDeleteBtn}
                                onPress={handleDeleteConfirm}
                            >
                                <Text style={styles.modalDeleteText}>Delete</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    flex:      { flex: 1 },
    container: { flex: 1, backgroundColor: '#FFFFFF' },

    // ─── Header ─────────────────────────────────────────────────
    header: {
        flexDirection:    'row',
        alignItems:       'center',
        height:           64,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#CAC4D0',
    },
    backButton: {
        width: 48, height: 48,
        alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: {
        flex:       1,
        textAlign:  'center',
        fontSize:   16,
        fontWeight: '600',
        color:      '#1D1B20',
    },
    headerSpacer: { width: 48 },

    // ─── Scroll ─────────────────────────────────────────────────
    scroll:        { flex: 1 },
    scrollContent: { padding: 20, paddingBottom: 32 },

    // ─── Field label ─────────────────────────────────────────────
    fieldLabelRow: {
        flexDirection: 'row',
        alignItems:    'center',
        marginBottom:  8,
        gap:           8,
    },
    fieldLabelText: {
        fontSize:      13,
        fontWeight:    '600',
        color:         '#5F5E5A',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    editedBadge: {
        backgroundColor: '#FFF4E5',
        borderRadius:    4,
        paddingHorizontal: 6,
        paddingVertical:   2,
        borderWidth:     1,
        borderColor:     '#F08C00',
    },
    editedBadgeText: {
        fontSize:   11,
        color:      '#F08C00',
        fontWeight: '600',
    },

    // ─── Original value (audit trail) ───────────────────────────
    originalRow: {
        flexDirection: 'row',
        flexWrap:      'wrap',
        marginBottom:  12,
        paddingHorizontal: 2,
    },
    originalLabel: {
        fontSize:   12,
        color:      '#B4B2A9',
        fontStyle:  'italic',
    },
    originalValue: {
        fontSize:   12,
        color:      '#B4B2A9',
        fontStyle:  'italic',
        flex:       1,
    },

    // ─── Text input ─────────────────────────────────────────────
    input: {
        borderWidth:    1.5,
        borderColor:    '#CAC4D0',
        borderRadius:   8,
        padding:        14,
        fontSize:       16,
        color:          '#1D1B20',
        minHeight:      120,
        textAlignVertical: 'top',
        lineHeight:     24,
    },
    // Edited field: bottom accent border to signal nurse-modified value
    inputEdited: {
        borderColor:       '#F08C00',
        borderBottomWidth: 3,
    },

    // ─── Error ──────────────────────────────────────────────────
    errorText: {
        marginTop: 8,
        fontSize:  13,
        color:     '#B3261E',
    },

    // ─── Actions ────────────────────────────────────────────────
    actions: {
        flexDirection: 'row',
        gap:           12,
        marginTop:     24,
    },
    cancelBtn: {
        flex:            1,
        height:          48,
        alignItems:      'center',
        justifyContent:  'center',
        borderRadius:    24,
        borderWidth:     1,
        borderColor:     '#79747E',
    },
    cancelBtnText: {
        fontSize:   14,
        fontWeight: '600',
        color:      '#1D1B20',
    },
    saveBtn: {
        flex:           1,
        height:         48,
        alignItems:     'center',
        justifyContent: 'center',
        borderRadius:   24,
        backgroundColor: '#1D9E75',
    },
    saveBtnDisabled: {
        backgroundColor: '#B4B2A9',
    },
    saveBtnText: {
        fontSize:   14,
        fontWeight: '600',
        color:      '#FFFFFF',
    },

    // ─── Delete section ──────────────────────────────────────────
    deleteSection: {
        borderTopWidth:  0.5,
        borderTopColor:  '#E4E2DE',
        paddingVertical: 8,
        paddingHorizontal: 20,
    },
    deleteBtn: {
        flexDirection: 'row',
        alignItems:    'center',
        height:        48,
        gap:           8,
    },
    deleteBtnText: {
        fontSize:   14,
        color:      '#B3261E',
        fontWeight: '500',
    },

    // ─── Modal ──────────────────────────────────────────────────
    modalOverlay: {
        flex:            1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems:      'center',
        justifyContent:  'center',
        padding:         24,
    },
    modalBox: {
        backgroundColor: '#FFFFFF',
        borderRadius:    12,
        padding:         24,
        width:           '100%',
        maxWidth:        400,
        elevation:       4,
        shadowColor:     '#000',
        shadowOffset:    { width: 0, height: 2 },
        shadowOpacity:   0.2,
        shadowRadius:    8,
    },
    modalTitle: {
        fontSize:     18,
        fontWeight:   '700',
        color:        '#1D1B20',
        marginBottom: 12,
    },
    modalBody: {
        fontSize:     14,
        color:        '#5F5E5A',
        lineHeight:   22,
        marginBottom: 24,
    },
    modalActions: {
        flexDirection:  'row',
        justifyContent: 'flex-end',
        gap:            12,
    },
    modalCancelBtn: {
        paddingHorizontal: 20,
        paddingVertical:   10,
    },
    modalCancelText: {
        fontSize:   14,
        fontWeight: '600',
        color:      '#5F5E5A',
    },
    modalDeleteBtn: {
        paddingHorizontal: 20,
        paddingVertical:   10,
        backgroundColor:   '#B3261E',
        borderRadius:      20,
    },
    modalDeleteText: {
        fontSize:   14,
        fontWeight: '600',
        color:      '#FFFFFF',
    },
});
