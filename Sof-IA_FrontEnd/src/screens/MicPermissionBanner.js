/**
 * MicPermissionBanner
 *
 * Pure UI component — no service imports, no business logic.
 * All actions are delegated to the presenter via callback props.
 *
 * Props:
 *   status              'undetermined' | 'granted' | 'denied' | 'blocked'
 *   onRequestPermission called when nurse taps "Enable mic" (denied state)
 *   onOpenSettings      called when nurse taps "Open Settings" (blocked state)
 *
 * Hidden when status is 'granted' or 'undetermined'.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export function MicPermissionBanner({ status, onRequestPermission, onOpenSettings }) {
    if (status === 'granted' || status === 'undetermined') return null;

    const isBlocked = status === 'blocked';

    return (
        <View style={styles.banner}>
            <Text style={styles.message}>
                Microphone access is required to use this app. Please enable it in Settings.
            </Text>
            <TouchableOpacity
                style={styles.button}
                onPress={isBlocked ? onOpenSettings : onRequestPermission}
            >
                <Text style={styles.buttonText}>
                    {isBlocked ? 'Open Settings' : 'Enable mic'}
                </Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FCEBEB',
        borderWidth: 0.5,
        borderColor: '#F09595',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginHorizontal: 16,
        marginTop: 8,
        gap: 10,
    },
    message: {
        flex: 1,
        fontSize: 13,
        color: '#791F1F',
        lineHeight: 18,
    },
    button: {
        backgroundColor: '#fff',
        borderWidth: 0.5,
        borderColor: '#E24B4A',
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        flexShrink: 0,
    },
    buttonText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#A32D2D',
    },
});