/**
 * RecordingIndicator
 *
 * Persistent status badge mounted globally in App.js above the navigator.
 * Visible on every screen whenever recording is active.
 *
 * States:
 *   hidden             — not recording
 *   recording + online — pulsing red dot + "Recording" label
 *   recording + offline — amber dot + "Buffering" label
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function RecordingIndicator({ isRecording, connectionStatus }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (isRecording) {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulseLoop.current.start();
    } else {
      if (pulseLoop.current) {
        pulseLoop.current.stop();
        pulseLoop.current = null;
      }
      pulseAnim.setValue(1);
    }

    return () => {
      if (pulseLoop.current) pulseLoop.current.stop();
    };
  }, [isRecording]);

  if (!isRecording) return null;

  const isOffline = connectionStatus === 'offline-buffering';
  const dotColor = isOffline ? '#D48A00' : '#A32D2D';
  const label = isOffline ? 'Buffering' : 'Recording';

  return (
    <View style={[styles.container, { top: insets.top + 4 }]} pointerEvents="none">
      <Animated.View style={[styles.dot, { backgroundColor: dotColor, opacity: pulseAnim }]} />
      <Text style={[styles.label, { color: dotColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    zIndex: 999,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
});