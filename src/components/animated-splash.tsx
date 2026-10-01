import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, useColorScheme } from 'react-native';

import { Brand, Colors } from '@/constants/theme';

// Must match the expo-splash-screen colors in app.json so the native splash
// hands off to this overlay without a visible seam.
//
// This is the one place that reads the SYSTEM scheme directly instead of the
// app's Appearance setting: the native splash is drawn by the OS before any of
// our code runs, so it follows the phone. Matching the user's override here
// would put a light overlay on top of a dark native splash, or the reverse.
// Nor does it take the accent — the native splash colour is baked into the
// build, so it can't change with a setting.
const SPLASH = {
  light: {
    background: '#FFFFFF',
    mark: require('../../assets/images/spendly-mark.png'),
    ink: Brand.navy,
    tagline: Colors.light.textSecondary,
  },
  dark: {
    background: Colors.dark.background,
    // The navy bars disappear on navy-black, so dark mode uses the white-bar mark.
    mark: require('../../assets/images/spendly-mark-light.png'),
    ink: '#FFFFFF',
    tagline: Colors.dark.textSecondary,
  },
} as const;

const BADGE_SIZE = 180; // same as the native splash imageWidth

/**
 * A short branded intro shown right after the native splash: the mark settles,
 * the wordmark fades up, then the whole overlay dissolves into the app.
 */
export function AnimatedSplash() {
  const scheme = useColorScheme();
  const [done, setDone] = useState(false);

  const badgeScale = useRef(new Animated.Value(1)).current;
  const textReveal = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(badgeScale, {
          toValue: 1.06,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(textReveal, {
          toValue: 1,
          duration: 450,
          delay: 120,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(600),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 400,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => setDone(true));
  }, [badgeScale, textReveal, overlayOpacity]);

  if (done) return null;

  const look = scheme === 'dark' ? SPLASH.dark : SPLASH.light;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.overlay,
        {
          backgroundColor: look.background,
          opacity: overlayOpacity,
        },
      ]}>
      <Animated.Image
        source={look.mark}
        style={[styles.badge, { transform: [{ scale: badgeScale }] }]}
      />
      <Animated.View
        style={[
          styles.textBlock,
          {
            opacity: textReveal,
            transform: [
              {
                translateY: textReveal.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, 0],
                }),
              },
            ],
          },
        ]}>
        {/* Two-tone like the mark: navy (or white) bars, teal arrow. */}
        <Animated.Text style={[styles.name, { color: look.ink }]}>
          Spend<Animated.Text style={styles.suffix}>ly</Animated.Text>
        </Animated.Text>
        <Animated.Text style={[styles.tagline, { color: look.tagline }]}>
          Every rupee, tracked
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
  },
  textBlock: {
    position: 'absolute',
    top: '50%',
    marginTop: BADGE_SIZE / 2 + 28,
    alignItems: 'center',
  },
  name: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  suffix: {
    color: Brand.teal,
  },
  tagline: {
    fontSize: 15,
    fontWeight: '500',
    marginTop: 6,
  },
});
