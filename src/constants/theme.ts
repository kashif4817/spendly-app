/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * The two colours of the Spendly mark: navy bars, teal arrow. The palette
 * below is built from them — navy for ink and dark surfaces, teal for action.
 */
export const Brand = {
  navy: '#002C6C',
  teal: '#08AE90',
} as const;

/**
 * Light: navy ink on white cards over a cool blue-grey page, so cards lift off
 * the background without needing borders or shadows.
 * Dark: the same idea on a navy-black page instead of pure black.
 */
export const Colors = {
  light: {
    text: '#0B1B3D',
    background: '#F3F6FB',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E3E9F3',
    textSecondary: '#5B6780',
  },
  dark: {
    text: '#EDF1F8',
    background: '#060B16',
    backgroundElement: '#0F1829',
    backgroundSelected: '#1A2640',
    textSecondary: '#94A0B8',
  },
} as const;

/**
 * The dashboard's overview card: a soft mint that stays the same in both
 * themes, so it's the one bright, friendly spot on the page either way. Text
 * and money colours here are darker than usual to stay readable on mint (all
 * 4.5:1 or better).
 */
export const HeroCard = {
  background: '#D4F2E9',
  /** White wash for the net row and inner controls. */
  inset: 'rgba(255,255,255,0.6)',
  divider: 'rgba(11,27,61,0.12)',
  glow: 'rgba(255,255,255,0.45)',
  glowTeal: 'rgba(8,174,144,0.16)',
  text: '#0B1B3D',
  textSecondary: '#46606F',
  in: '#06705B',
  out: '#B8333A',
} as const;

/**
 * Accent colours offered in Settings.
 *
 * Each one is dark enough to carry white text as a filled button, and bright
 * enough to read as a tint on both the light and the dark background — the
 * accent is used both ways all over the app, so a single value per theme has
 * to work in both roles. Teal is the logo's arrow, darkened just enough to
 * carry white text (4.5:1).
 *
 * Emerald was retired with the rebrand; anyone who had picked it falls back to
 * teal, which is the nearest colour anyway.
 */
export const Accents = {
  teal: { label: 'Teal', color: '#07866F' },
  ocean: { label: 'Ocean', color: '#1F6FEB' },
  violet: { label: 'Violet', color: '#6D3BEF' },
  rose: { label: 'Rose', color: '#C2255C' },
  amber: { label: 'Amber', color: '#B45309' },
} as const;

export type AccentKey = keyof typeof Accents;

export const ACCENT_KEYS = Object.keys(Accents) as AccentKey[];

/** The brand accent, and the fallback for anything unreadable. */
export const DEFAULT_ACCENT: AccentKey = 'teal';

export type ThemeColor = (keyof typeof Colors.light & keyof typeof Colors.dark) | 'accent';

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
