import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, useColorScheme } from 'react-native';

// Must match the expo-splash-screen colors in app.json so the native splash
// hands off to this overlay without a visible seam.
const EMERALD = '#0B7C4F';
const EMERALD_DARK = '#081C13';

const BADGE_SIZE = 180; // same as the native splash imageWidth

/**
 * A short branded intro shown right after the native splash: the coin settles,
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

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.overlay,
        {
          backgroundColor: scheme === 'dark' ? EMERALD_DARK : EMERALD,
          opacity: overlayOpacity,
        },
      ]}>
      <Animated.Image
        source={require('../../assets/images/splash-icon.png')}
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
        <Animated.Text style={styles.name}>Spendly</Animated.Text>
        <Animated.Text style={styles.tagline}>Every rupee, tracked</Animated.Text>
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
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tagline: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 15,
    fontWeight: '500',
    marginTop: 6,
  },
});
