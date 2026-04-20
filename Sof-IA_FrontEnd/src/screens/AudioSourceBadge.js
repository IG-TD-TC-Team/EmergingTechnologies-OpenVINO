/**
 * AudioSourceBadge
 *
 * Pure UI — no business logic.
 *
 * AudioSourceBadge:
 *   - Tappable pill showing the active source
 *   - Shows a chevron icon when toggle is available (USB connected)
 *   - onPress → calls presenter.onToggleSource()
 *
 * MicInputIcon:
 *   - Icon for the bottom action bar
 *   - Green dot = USB-C active
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export function AudioSourceBadge({ sourceKey, sourceLabel, canToggle, onPress, style }) {
    const isUsb = sourceKey === 'usb';

    return (
        <TouchableOpacity
            style={[styles.badge, isUsb ? styles.badgeUsb : styles.badgeBuiltin, style]}
            onPress={canToggle ? onPress : undefined}
            activeOpacity={canToggle ? 0.7 : 1}
            accessibilityLabel={canToggle ? `Active source: ${sourceLabel}. Tap to switch.` : `Active source: ${sourceLabel}`}
        >
            <View style={[styles.dot, isUsb ? styles.dotUsb : styles.dotBuiltin]} />
            <Text style={[styles.label, isUsb ? styles.labelUsb : styles.labelBuiltin]}>
                {sourceLabel}
            </Text>
            {/* Chevron — only shown when toggle is available */}
            {canToggle && (
                <Text style={[styles.chevron, isUsb ? styles.labelUsb : styles.labelBuiltin]}>
                    ⌄
                </Text>
            )}
        </TouchableOpacity>
    );
}

export function MicInputIcon({ sourceKey }) {
    const isUsb = sourceKey === 'usb';
    return (
        <View style={styles.iconWrapper}>
            <View style={[styles.iconCircle, isUsb ? styles.iconCircleUsb : styles.iconCircleBuiltin]} />
            {isUsb && <View style={styles.usbDot} />}
        </View>
    );
}

const styles = StyleSheet.create({
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 99,
        gap: 6,
    },
    badgeUsb: {
        backgroundColor: '#E1F5EE',
        borderWidth: 0.5,
        borderColor: '#1D9E75',
    },
    badgeBuiltin: {
        backgroundColor: '#F1EFE8',
        borderWidth: 0.5,
        borderColor: '#B4B2A9',
    },
    dot: { width: 7, height: 7, borderRadius: 99 },
    dotUsb: { backgroundColor: '#1D9E75' },
    dotBuiltin: { backgroundColor: '#888780' },
    label: { fontSize: 12, fontWeight: '500' },
    labelUsb: { color: '#0F6E56' },
    labelBuiltin: { color: '#5F5E5A' },
    chevron: { fontSize: 12, marginLeft: 2, marginTop: -2 },
    iconWrapper: {
        position: 'relative',
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
    iconCircleUsb: { borderColor: '#1D9E75' },
    iconCircleBuiltin: { borderColor: '#888780' },
    usbDot: {
        position: 'absolute',
        top: 1,
        right: 1,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#1D9E75',
        borderWidth: 1.5,
        borderColor: '#fff',
    },
});