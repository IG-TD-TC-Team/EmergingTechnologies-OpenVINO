/**
 * MicPermissionBanner
 *
 * Pure UI component — no service imports, no business logic.
 * All actions are delegated to the presenter via callback props.
 *
 * Props:
 *   status              'undetermined' | 'granted' | 'denied' | 'blocked'
 *   onRequestPermission called when nurse taps "Enable mic"
 *   onOpenSettings      called when nurse taps "Open Settings" (Android blocked only)
 *
 * Android: hidden for 'undetermined' (OS dialog fires on first recording tap)
 * Chrome:  shows explanation prompt for 'undetermined' (first-use, before browser dialog)
 *          shows inline instructions for 'blocked' (Chrome settings can't be opened programmatically)
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { capabilities } from '../config/capabilities';

export function MicPermissionBanner({ status, onRequestPermission, onOpenSettings }) {
    const isWeb = capabilities.isWeb;

    if (status === 'granted') return null;
    // Android: hide when undetermined — OS dialog fires on first mic tap
    if (!isWeb && status === 'undetermined') return null;

    // Chrome: first-use explanation shown before the browser permission prompt fires
    if (isWeb && status === 'undetermined') {
        return (
            <View style={[styles.banner, styles.bannerInfo]}>
                <Text style={[styles.message, styles.messageInfo]}>
                    Microphone access is needed for ambient recording. Tap below to allow Chrome to record audio.
                </Text>
                <TouchableOpacity style={[styles.button, styles.buttonInfo]} onPress={onRequestPermission}>
                    <Text style={[styles.buttonText, styles.buttonTextInfo]}>Enable mic</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // Chrome: blocked — inline instructions since chrome://settings can't be opened from JS
    if (isWeb && (status === 'blocked' || status === 'denied')) {
        return (
            <View style={styles.banner}>
                <Text style={styles.message}>
                    Microphone blocked. To re-enable: click the lock icon in Chrome's address bar → Site settings → Microphone → Allow.
                </Text>
            </View>
        );
    }

    // Android: denied or blocked
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
    bannerInfo: {
        backgroundColor: '#EEF4FF',
        borderColor: '#93B4F0',
    },
    message: {
        flex: 1,
        fontSize: 13,
        color: '#791F1F',
        lineHeight: 18,
    },
    messageInfo: {
        color: '#1A3A6B',
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
    buttonInfo: {
        borderColor: '#4A7FD4',
    },
    buttonText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#A32D2D',
    },
    buttonTextInfo: {
        color: '#1A3A6B',
    },
});