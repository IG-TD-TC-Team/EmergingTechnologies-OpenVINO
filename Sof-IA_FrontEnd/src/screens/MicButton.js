/**
 * MicButton
 *
 * Mic toggle button for the Dashboard bottom bar.
 *
 * States:
 *   inactive  — solid green circle with a white dot (existing design)
 *   recording — red circle with an animated pulsing ring (<200ms feedback)
 *   disabled  — greyed out (permission blocked)
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';

export default function MicButton({ isRecording, isDisabled, onPress }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef(null);

  useEffect(() => {
    if (isRecording) {
      // Start pulsing animation
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(pulseAnim, {
              toValue: 1.35,
              duration: 600,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 0,
              duration: 600,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 0,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 0.6,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
      pulseLoop.current.start();
    } else {
      if (pulseLoop.current) {
        pulseLoop.current.stop();
        pulseLoop.current = null;
      }
      pulseAnim.setValue(1);
      opacityAnim.setValue(1);
    }

    return () => {
      if (pulseLoop.current) {
        pulseLoop.current.stop();
      }
    };
  }, [isRecording]);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
      accessibilityRole="button"
      style={styles.wrapper}
      activeOpacity={0.8}
    >
      {/* Pulsing ring — only visible while recording */}
      {isRecording && (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              transform: [{ scale: pulseAnim }],
              opacity: opacityAnim,
            },
          ]}
        />
      )}

      {/* Main button */}
      <View
        style={[
          styles.button,
          isRecording && styles.buttonRecording,
          isDisabled && styles.buttonDisabled,
        ]}
      >
        <View style={styles.innerDot} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#A32D2D',
    opacity: 0.4,
  },
  button: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRecording: {
    backgroundColor: '#A32D2D',
  },
  buttonDisabled: {
    backgroundColor: '#B4B2A9',
    opacity: 0.5,
  },
  innerDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
  },
});