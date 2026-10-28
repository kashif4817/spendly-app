/**
 * The pair of eyes that stands in for a covered balance.
 *
 * WHY IT'S DRAWN RATHER THAN PLAYED: the obvious ways to get animated eyes are
 * a Lottie file or an animated WebP, and both cost a native module or an asset
 * that can't follow the accent. This is four Views and three loops on the
 * native driver — it themes itself, scales to any size without going soft, and
 * ships over the air like the rest of the look.
 *
 * Three loops, deliberately out of step with each other so the pair never
 * settles into an obvious cycle:
 *
 *   gaze  — both irises track together, left, right, back to centre. Eyes that
 *           move independently read as a doll, not a face.
 *   blink — the eye squashes on Y. With `overflow: hidden` the iris squashes
 *           with it, which is what a lid closing actually looks like; a drawn
 *           lid would need an opaque colour, and there isn't one over glass.
 *   float — a slow bob under everything else, so the pair breathes at rest.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/** The dark of the pupil — the app's ink, never a flat black. */
const PUPIL = '#140F2E';

type Props = {
  /** Height of one eye. Everything else is in proportion to it. */
  size?: number;
  /** Iris colour. Defaults to the accent, so the pair matches the app. */
  color?: string;
};

export function PeekingEyes({ size = 54, color }: Props) {
  const theme = useTheme();
  const iris = color ?? theme.accent;

  const eyeW = size * 0.76;
  const irisSize = size * 0.46;
  const pupilSize = irisSize * 0.46;
  const glintSize = irisSize * 0.28;
  // How far an iris can slide before it would clip the white.
  const travelX = ((eyeW - irisSize) / 2) * 0.8;
  const travelY = ((size - irisSize) / 2) * 0.3;

  const gaze = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const look = (toValue: number, duration: number) =>
      Animated.timing(gaze, {
        toValue,
        duration,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      });

    const shut = Animated.timing(blink, {
      toValue: 0.06,
      duration: 80,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    const open = Animated.timing(blink, {
      toValue: 1,
      duration: 130,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });

    const gazeLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(700),
        look(-1, 300),
        Animated.delay(850),
        look(1, 430),
        Animated.delay(850),
        look(0, 300),
        Animated.delay(900),
      ])
    );

    // A double blink: one on its own looks like a dropped frame.
    const blinkLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(2600),
        shut,
        open,
        Animated.delay(240),
        Animated.timing(blink, {
          toValue: 0.06,
          duration: 80,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(blink, {
          toValue: 1,
          duration: 130,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(2100),
      ])
    );

    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 1900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 1900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    gazeLoop.start();
    blinkLoop.start();
    floatLoop.start();

    return () => {
      gazeLoop.stop();
      blinkLoop.stop();
      floatLoop.stop();
    };
  }, [gaze, blink, float]);

  const irisTransform = [
    {
      translateX: gaze.interpolate({
        inputRange: [-1, 1],
        outputRange: [-travelX, travelX],
      }),
    },
    {
      // The corners sit a little lower than the centre: a real eye sweeps an
      // arc, it doesn't run along a rail. Centre stays at zero so the pair is
      // properly level at rest, which is most of the time.
      translateY: gaze.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: [travelY, 0, travelY],
      }),
    },
  ];

  const eye = (tilt: number) => (
    <Animated.View
      style={[
        styles.eye,
        {
          width: eyeW,
          height: size,
          borderRadius: size,
          transform: [{ rotate: `${tilt}deg` }, { scaleY: blink }],
        },
      ]}>
      <Animated.View
        style={[
          styles.iris,
          {
            width: irisSize,
            height: irisSize,
            borderRadius: irisSize,
            backgroundColor: iris,
            transform: irisTransform,
          },
        ]}>
        <View
          style={{
            width: pupilSize,
            height: pupilSize,
            borderRadius: pupilSize,
            backgroundColor: PUPIL,
          }}
        />
        {/* The catchlight. Without it the iris reads as a printed dot. */}
        <View
          style={[
            styles.glint,
            {
              width: glintSize,
              height: glintSize,
              borderRadius: glintSize,
              top: irisSize * 0.17,
              right: irisSize * 0.19,
            },
          ]}
        />
      </Animated.View>
    </Animated.View>
  );

  return (
    <Animated.View
      accessibilityRole="image"
      accessibilityLabel="Balance hidden"
      style={[
        styles.pair,
        {
          gap: size * 0.17,
          transform: [
            { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [2.5, -2.5] }) },
          ],
        },
      ]}>
      {eye(-7)}
      {eye(7)}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pair: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eye: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    // Squashing the eye has to squash the iris with it, or the pupil floats
    // free of the lid mid-blink.
    overflow: 'hidden',
    borderWidth: 1,
    // Pure white on a pale glass card needs an edge or it dissolves into it.
    borderColor: 'rgba(23,18,67,0.10)',
    boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(23,18,67,0.18)' }],
  },
  iris: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glint: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
});
