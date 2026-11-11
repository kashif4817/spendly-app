import { useEffect, useState } from 'react';
import { Appearance, Image, StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { appearanceHydrated } from '@/lib/appearance';
import { useSync } from '@/sync/provider';

const MARK = require('../../assets/images/spendly-mark.png');
/** Same mark with the navy bars in white, for dark backgrounds. */
const MARK_LIGHT = require('../../assets/images/spendly-mark-light.png');

/**
 * What the NATIVE splash draws. Must match `expo-splash-screen` in app.json —
 * the overlay's first frame is a copy of it, which is the whole trick behind a
 * seamless hand-off.
 *
 * Keyed by the PHONE's scheme, not the app's Appearance setting: the native
 * splash is drawn by the OS before any of our code runs, so it can only follow
 * the phone. The overlay then blooms from this into the user's own choice.
 */
const NATIVE = {
  light: { background: Colors.light.background, mark: MARK },
  dark: { background: Colors.dark.background, mark: MARK_LIGHT },
} as const;

/** The native splash's imageWidth in app.json. */
const NATIVE_SIZE = 180;
/** The glass tile the mark settles into, and the mark's size inside it. */
const TILE = 132;
const TILE_RADIUS = 38;
const SETTLED_SCALE = 92 / NATIVE_SIZE;
/** The box the glow, tile and mark are laid out in. */
const STAGE = 360;

/** Shortest intro, so it never flickers past on a fast phone. */
const MIN_SHOW_MS = 1400;
/** Longest it will wait for the session before leaving anyway. */
const MAX_SHOW_MS = 3500;
const EXIT_MS = 440;
/** How long to wait for the saved theme before starting with the defaults. */
const HYDRATE_CAP_MS = 300;

type Stage = 'native' | 'intro' | 'exit' | 'done';

/** '#6A45F5' → 'rgba(106,69,245,a)'. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * The branded intro between the native splash and the app.
 *
 *   1. Its first frame is the native splash, pixel for pixel.
 *   2. The Aurora mesh blooms in — in the user's own scheme — while the mark
 *      shrinks into a glass tile lit from behind by their accent.
 *   3. "Spendly" rises in, a light glint crosses the tile, and the glow breathes
 *      for as long as the session takes to restore.
 *   4. It zooms through and dissolves into the app underneath.
 *
 * With Reduce Motion on, all of that collapses to two short cross-fades.
 */
export function AnimatedSplash() {
  const theme = useTheme();
  const { ready } = useSync();
  const reduceMotion = useReducedMotion();

  // Fixed for this launch: it's what the OS drew a moment ago.
  const [phone] = useState<'light' | 'dark'>(() =>
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'
  );
  const [stage, setStage] = useState<Stage>('native');
  const [minShown, setMinShown] = useState(false);
  const [maxShown, setMaxShown] = useState(false);

  const bloom = useSharedValue(0); // native solid → the user's Aurora
  const settle = useSharedValue(0); // mark: native size → inside the tile
  const tile = useSharedValue(0);
  const glow = useSharedValue(0);
  const breath = useSharedValue(0);
  const words = useSharedValue(0);
  const tagline = useSharedValue(0);
  const shine = useSharedValue(0);
  const exit = useSharedValue(0);

  // 1. Start once the saved theme is known (or shortly after, regardless).
  //    Until then the overlay sits there looking exactly like the native splash.
  useEffect(() => {
    let alive = true;
    const cap = new Promise<void>((resolve) => setTimeout(resolve, HYDRATE_CAP_MS));
    Promise.race([appearanceHydrated, cap]).then(() => {
      if (alive) setStage('intro');
    });
    return () => {
      alive = false;
    };
  }, []);

  // 2. The intro.
  useEffect(() => {
    if (stage !== 'intro') return;

    if (reduceMotion) {
      const fade = { duration: 280 };
      bloom.value = withTiming(1, fade);
      settle.value = withTiming(1, fade);
      tile.value = withTiming(1, fade);
      glow.value = withTiming(1, fade);
      words.value = withTiming(1, fade);
      tagline.value = withTiming(1, fade);
    } else {
      const out = Easing.out(Easing.cubic);
      const swell = Easing.inOut(Easing.sin);
      bloom.value = withTiming(1, { duration: 700, easing: out });
      settle.value = withDelay(60, withSpring(1, { damping: 15, stiffness: 120, mass: 0.9 }));
      tile.value = withDelay(150, withSpring(1, { damping: 13, stiffness: 150, mass: 0.8 }));
      glow.value = withDelay(180, withTiming(1, { duration: 850, easing: out }));
      words.value = withDelay(380, withTiming(1, { duration: 480, easing: out }));
      tagline.value = withDelay(560, withTiming(1, { duration: 480, easing: out }));
      shine.value = withDelay(760, withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) }));
      breath.value = withDelay(
        1050,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 1100, easing: swell }),
            withTiming(0, { duration: 1100, easing: swell })
          ),
          -1
        )
      );
    }

    const min = setTimeout(() => setMinShown(true), reduceMotion ? 700 : MIN_SHOW_MS);
    const max = setTimeout(() => setMaxShown(true), MAX_SHOW_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(max);
    };
  }, [stage, reduceMotion, bloom, settle, tile, glow, breath, words, tagline, shine]);

  // 3. Leave once the intro has played AND the session is back — straight into
  //    the app, instead of into AuthGate's spinner. Capped, so a slow restore
  //    can never hold the splash up.
  useEffect(() => {
    if (stage === 'intro' && minShown && (ready || maxShown)) setStage('exit');
  }, [stage, minShown, ready, maxShown]);

  // 4. The exit.
  useEffect(() => {
    if (stage !== 'exit') return;
    const ms = reduceMotion ? 260 : EXIT_MS;
    exit.value = withTiming(1, { duration: ms, easing: Easing.in(Easing.cubic) });
    const timer = setTimeout(() => {
      cancelAnimation(breath);
      setStage('done');
    }, ms + 60);
    return () => clearTimeout(timer);
  }, [stage, reduceMotion, exit, breath]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));
  const auroraStyle = useAnimatedStyle(() => ({ opacity: bloom.value }));
  const fadeOutStyle = useAnimatedStyle(() => ({ opacity: 1 - bloom.value }));
  const fadeInStyle = useAnimatedStyle(() => ({ opacity: bloom.value }));

  // Everything at the centre zooms through together on the way out.
  const centreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(exit.value, [0, 1], [1, 1.1]) }],
  }));

  const markStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(settle.value, [0, 1], [1, SETTLED_SCALE]) }],
  }));

  const tileStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tile.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(tile.value, [0, 1], [0.55, 1]) }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * (0.8 + 0.2 * breath.value),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.45, 1]) * (1 + 0.07 * breath.value) }],
  }));

  const shineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shine.value, [0, 0.12, 0.88, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: interpolate(shine.value, [0, 1], [-TILE * 1.1, TILE * 1.1]) },
      { rotate: '20deg' },
    ],
  }));

  const wordsStyle = useAnimatedStyle(() => ({
    opacity: words.value,
    transform: [{ translateY: (1 - words.value) * 14 }],
  }));

  const taglineStyle = useAnimatedStyle(() => ({
    opacity: tagline.value,
    transform: [{ translateY: (1 - tagline.value) * 10 }],
  }));

  if (stage === 'done') return null;

  const dark = theme.scheme === 'dark';
  const startMark = NATIVE[phone].mark;
  const endMark = dark ? MARK_LIGHT : MARK;
  const glowFill = `radial-gradient(circle at 50% 50%, ${withAlpha(theme.accent, dark ? 0.55 : 0.36)} 0%, transparent 66%)`;
  const shineFill = `linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,${dark ? 0.32 : 0.7}) 50%, rgba(255,255,255,0) 100%)`;

  return (
    <Reanimated.View
      // Holds touches while it is on screen; lets them through as it leaves.
      pointerEvents={stage === 'exit' ? 'none' : 'auto'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.fill, overlayStyle]}>
      {/* The native splash's own colour, then the user's Aurora over it. */}
      <View style={[styles.fill, { backgroundColor: NATIVE[phone].background }]} />
      <Reanimated.View
        style={[
          styles.fill,
          { backgroundColor: theme.background, experimental_backgroundImage: theme.mesh },
          auroraStyle,
        ]}
      />

      <View style={[styles.fill, styles.centre]}>
        <Reanimated.View style={[styles.stage, centreStyle]}>
          <Reanimated.View style={[styles.glow, { experimental_backgroundImage: glowFill }, glowStyle]} />
          <Reanimated.View style={[styles.tile, theme.glassStrong, tileStyle]} />

          <Reanimated.View style={[styles.mark, markStyle]}>
            {startMark === endMark ? (
              <Image source={endMark} style={styles.markImage} fadeDuration={0} />
            ) : (
              <>
                <Reanimated.Image source={startMark} style={[styles.markImage, fadeOutStyle]} fadeDuration={0} />
                <Reanimated.Image source={endMark} style={[styles.markImage, fadeInStyle]} fadeDuration={0} />
              </>
            )}
          </Reanimated.View>

          {/* A glint across the glass, clipped to the tile. Over the mark,
              so it catches the logo too. */}
          <View style={styles.shineClip}>
            <Reanimated.View style={[styles.shine, { experimental_backgroundImage: shineFill }, shineStyle]} />
          </View>
        </Reanimated.View>
      </View>

      <View style={styles.textBlock}>
        <Reanimated.View style={wordsStyle}>
          <Text style={[styles.name, { color: theme.text }]}>
            Spend<Text style={{ color: theme.accentTint }}>ly</Text>
          </Text>
        </Reanimated.View>
        <Reanimated.View style={taglineStyle}>
          <Text style={[styles.tagline, { color: theme.textSecondary }]}>Every rupee, tracked</Text>
        </Reanimated.View>
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    width: STAGE,
    height: STAGE,
  },
  glow: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: STAGE,
    height: STAGE,
    borderRadius: STAGE / 2,
  },
  tile: {
    position: 'absolute',
    left: (STAGE - TILE) / 2,
    top: (STAGE - TILE) / 2,
    width: TILE,
    height: TILE,
    borderRadius: TILE_RADIUS,
  },
  mark: {
    position: 'absolute',
    left: (STAGE - NATIVE_SIZE) / 2,
    top: (STAGE - NATIVE_SIZE) / 2,
    width: NATIVE_SIZE,
    height: NATIVE_SIZE,
  },
  markImage: {
    ...StyleSheet.absoluteFillObject,
    width: NATIVE_SIZE,
    height: NATIVE_SIZE,
  },
  shineClip: {
    position: 'absolute',
    left: (STAGE - TILE) / 2,
    top: (STAGE - TILE) / 2,
    width: TILE,
    height: TILE,
    borderRadius: TILE_RADIUS,
    overflow: 'hidden',
  },
  shine: {
    position: 'absolute',
    top: -TILE * 0.35,
    left: TILE * 0.3,
    width: TILE * 0.42,
    height: TILE * 1.7,
  },
  textBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: TILE / 2 + 34,
    alignItems: 'center',
  },
  name: {
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  tagline: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginTop: 4,
  },
});
