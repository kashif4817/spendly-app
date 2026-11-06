/**
 * The thing you look at, or put your thumb on.
 *
 * WHY IT EXISTS: the OS sheet is the real authentication, but it is a sheet —
 * it can be dismissed, and on a cold start it has often come and gone before
 * the user has focused on the screen. Without something to look at, a failed
 * or cancelled face scan leaves a PIN pad and no hint that the phone was ever
 * willing to do it the easy way. This is that hint, and it is also the way
 * back: tapping it asks again.
 *
 * TWO SHAPES, because the two things are not alike:
 *
 *   face        — a rounded viewfinder with corner brackets, the universal
 *                 "point this at your face". A scanning line sweeps it.
 *   fingerprint — a ring around the print, pulsing where a thumb would go.
 *
 * Drawing the fingerprint icon inside a camera frame (or the reverse) is the
 * kind of small wrongness people cannot name but do notice.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { BiometricKind } from '@/lock/app-lock';

const DANGER = '#e5484d';

/** The box is square; this is its side. */
const SIZE = 104;

export type BiometricState = 'idle' | 'scanning' | 'failed';

export function BiometricTarget({
  kind,
  state = 'idle',
  label,
  hint,
  onPress,
}: {
  kind: BiometricKind;
  state?: BiometricState;
  /** What it is called — "Face Unlock", "Fingerprint". */
  label: string;
  /** The line under it, usually how to get past it instead. */
  hint?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const isFace = kind === 'face' || kind === 'iris';

  const pulse = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state === 'failed') {
      pulse.setValue(0);
      sweep.setValue(0);
      return;
    }

    // Slower at rest, quicker while the sheet is actually up, so the target
    // says which of the two is happening without a word of text.
    const duration = state === 'scanning' ? 900 : 1600;
    const loops = [
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ),
    ];
    if (isFace) {
      loops.push(
        Animated.loop(
          Animated.timing(sweep, { toValue: 1, duration: duration * 1.6, easing: Easing.linear, useNativeDriver: true })
        )
      );
    }

    const running = Animated.parallel(loops);
    running.start();
    // Stopped rather than left running: this unmounts the moment the app
    // unlocks, and a loop that outlived its view would keep a frame callback
    // alive for the rest of the session.
    return () => running.stop();
  }, [state, isFace, pulse, sweep]);

  const tint = state === 'failed' ? DANGER : theme.accent;

  const ringStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.75] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
  };

  const sweepStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }),
    transform: [
      {
        translateY: sweep.interpolate({
          inputRange: [0, 1],
          outputRange: [-SIZE / 2 + 14, SIZE / 2 - 14],
        }),
      },
    ],
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Unlock with ${label}`}
        accessibilityHint={hint}>
        {/* The halo. Behind everything, so the brackets stay crisp. */}
        <Animated.View
          style={[
            styles.halo,
            isFace ? styles.haloFace : styles.haloRound,
            { borderColor: tint },
            ringStyle,
          ]}
          pointerEvents="none"
        />

        <View
          style={[
            styles.frame,
            isFace ? styles.frameFace : styles.frameRound,
            theme.glass,
            state === 'failed' && { borderColor: DANGER, borderWidth: 1 },
          ]}>
          {isFace && (
            <>
              {/* Four corner brackets — the viewfinder. Drawn as borders on
                  small boxes, which costs nothing and scales cleanly. */}
              <View style={[styles.corner, styles.tl, { borderColor: tint }]} />
              <View style={[styles.corner, styles.tr, { borderColor: tint }]} />
              <View style={[styles.corner, styles.bl, { borderColor: tint }]} />
              <View style={[styles.corner, styles.br, { borderColor: tint }]} />
              {state !== 'failed' && (
                <Animated.View
                  style={[styles.sweepLine, { backgroundColor: tint }, sweepStyle]}
                  pointerEvents="none"
                />
              )}
            </>
          )}

          <MaterialIcons
            name={state === 'failed' ? 'error-outline' : isFace ? 'face' : 'fingerprint'}
            size={isFace ? 44 : 52}
            color={tint}
          />
        </View>
      </Pressable>

      <ThemedText type="smallBold" style={[styles.label, state === 'failed' && { color: DANGER }]}>
        {state === 'failed' ? 'Not recognised — tap to try again' : label}
      </ThemedText>
      {!!hint && state !== 'failed' && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {hint}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  hit: {
    width: SIZE + 16,
    height: SIZE + 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: SIZE + 12,
    height: SIZE + 12,
    borderWidth: 2,
  },
  haloRound: {
    borderRadius: (SIZE + 12) / 2,
  },
  haloFace: {
    borderRadius: Radius.large,
  },
  frame: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  frameRound: {
    borderRadius: SIZE / 2,
  },
  frameFace: {
    borderRadius: Radius.large,
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
  },
  tl: { top: 10, left: 10, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 8 },
  tr: { top: 10, right: 10, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 8 },
  bl: { bottom: 10, left: 10, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderBottomLeftRadius: 8 },
  br: { bottom: 10, right: 10, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderBottomRightRadius: 8 },
  sweepLine: {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 2,
  },
  label: {
    textAlign: 'center',
  },
  hint: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
