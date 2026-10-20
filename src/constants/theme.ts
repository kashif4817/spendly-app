/**
 * Spendly's look: "Aurora" — a glassmorphism system.
 *
 * HOW THE GLASS IS BUILT, since React Native has no `backdrop-filter`:
 *
 *   1. A mesh of coloured light (`Mesh`) is painted across the whole app by
 *      <AuroraBackground>, using RN 0.81's native `experimental_backgroundImage`.
 *      Glass needs something behind it; a flat page gives it nothing to do.
 *   2. Every surface is a translucent fill + a bright hairline edge + an inset
 *      highlight along its top (`Glass`). Blur only removes high-frequency
 *      detail, and a smooth gradient has none — so over this mesh, layered
 *      translucency is visually all but identical to a real frosted pane, at
 *      no cost and with no native module.
 *
 * Nothing here needs expo-blur or expo-linear-gradient, which means the whole
 * look ships over the air — no new APK.
 */

import '@/global.css';

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * The four lights in the mesh. Indigo leads, azure cools it, fuchsia warms the
 * shadows and a little amber keeps the whole thing from reading as cold tech.
 */
export const Aurora = {
  indigo: '#7C5CFF',
  azure: '#3B82F6',
  fuchsia: '#C04DFF',
  amber: '#FF9361',
} as const;

/**
 * The mesh, per theme — four lights over a diagonal ground.
 *
 * `circle at <x%> <y%>` is the one radial form RN parses on both platforms.
 * The layers are painted first-on-top, exactly as on the web.
 */
export const Mesh = {
  light: [
    'radial-gradient(circle at 10% 4%, rgba(124,92,255,0.40) 0%, transparent 62%)',
    'radial-gradient(circle at 92% 16%, rgba(59,130,246,0.34) 0%, transparent 64%)',
    'radial-gradient(circle at 82% 88%, rgba(192,77,255,0.26) 0%, transparent 66%)',
    'radial-gradient(circle at 14% 94%, rgba(255,147,97,0.24) 0%, transparent 62%)',
    'linear-gradient(160deg, #E8ECFD 0%, #E4E6FA 48%, #F0E8FA 100%)',
  ].join(', '),
  dark: [
    'radial-gradient(circle at 10% 4%, rgba(124,92,255,0.38) 0%, transparent 60%)',
    'radial-gradient(circle at 92% 16%, rgba(59,130,246,0.32) 0%, transparent 62%)',
    'radial-gradient(circle at 82% 88%, rgba(192,77,255,0.30) 0%, transparent 64%)',
    'radial-gradient(circle at 14% 94%, rgba(255,147,97,0.16) 0%, transparent 60%)',
    'linear-gradient(160deg, #09071A 0%, #0D0B24 50%, #140C22 100%)',
  ].join(', '),
} as const;

/**
 * Light: white frost over a pale mesh — the fill carries most of the contrast,
 * so text stays readable where the mesh goes bright.
 * Dark: a thin white wash over a near-black indigo, where glass reads best.
 *
 * `backgroundElement` is the card fill and is deliberately TRANSLUCENT: every
 * surface in the app already reads from it, so the mesh shows through the
 * whole UI without touching each screen.
 */
export const Colors = {
  light: {
    text: '#171243',
    background: '#E8ECFD',
    backgroundElement: 'rgba(255,255,255,0.52)',
    backgroundSelected: 'rgba(255,255,255,0.80)',
    textSecondary: '#524B80',
  },
  dark: {
    text: '#F2F0FF',
    background: '#09071A',
    backgroundElement: 'rgba(255,255,255,0.085)',
    backgroundSelected: 'rgba(255,255,255,0.17)',
    textSecondary: '#A7A0CC',
  },
} as const;

export type ThemeColor = (keyof typeof Colors.light & keyof typeof Colors.dark) | 'accent';

/**
 * The three depths of glass, as styles to spread onto any surface.
 *
 *   weak   — a chip or inset sitting ON another glass surface
 *   base   — an ordinary card or row
 *   strong — the one thing a screen is about (a balance, a hero)
 *
 * Each is fill + hairline edge + an inset highlight along the top, which is
 * what reads as a lit pane rather than a flat tint. Frozen per theme so a
 * re-render doesn't rebuild them.
 */
type GlassSet = { weak: ViewStyle; base: ViewStyle; strong: ViewStyle; overlay: ViewStyle };

export const Glass: Record<'light' | 'dark', GlassSet> = {
  light: {
    weak: {
      backgroundColor: 'rgba(255,255,255,0.34)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.50)',
    },
    base: {
      backgroundColor: 'rgba(255,255,255,0.52)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.62)',
      boxShadow: [
        { offsetX: 0, offsetY: 6, blurRadius: 24, color: 'rgba(23,18,67,0.10)' },
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.85)', inset: true },
      ],
    },
    strong: {
      backgroundColor: 'rgba(255,255,255,0.68)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.80)',
      boxShadow: [
        { offsetX: 0, offsetY: 10, blurRadius: 34, color: 'rgba(23,18,67,0.14)' },
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.95)', inset: true },
      ],
    },
    overlay: {
      backgroundColor: 'rgba(247,246,255,0.90)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.90)',
      boxShadow: [
        { offsetX: 0, offsetY: -8, blurRadius: 40, color: 'rgba(23,18,67,0.22)' },
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,1)', inset: true },
      ],
    },
  },
  dark: {
    weak: {
      backgroundColor: 'rgba(255,255,255,0.055)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.10)',
    },
    base: {
      backgroundColor: 'rgba(255,255,255,0.085)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
      boxShadow: [
        { offsetX: 0, offsetY: 6, blurRadius: 24, color: 'rgba(0,0,0,0.34)' },
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.20)', inset: true },
      ],
    },
    strong: {
      backgroundColor: 'rgba(255,255,255,0.13)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.20)',
      boxShadow: [
        { offsetX: 0, offsetY: 10, blurRadius: 34, color: 'rgba(0,0,0,0.44)' },
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.28)', inset: true },
      ],
    },
    // A sheet sits over a scrim, so a white wash would only go murky. This is
    // a tinted dark pane instead — still translucent, still lit at the edge.
    overlay: {
      backgroundColor: 'rgba(20,16,46,0.92)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.18)',
      boxShadow: [
        { offsetX: 0, offsetY: -8, blurRadius: 40, color: 'rgba(0,0,0,0.55)' },
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.22)', inset: true },
      ],
    },
  },
};

/**
 * Glass for a TEXT INPUT.
 *
 * The sets above are `ViewStyle`, which a `TextInput`'s style prop will not
 * accept — and its view-only parts (the shadow, the inner highlight) would
 * not paint on one regardless. Fill and edge only.
 */
export const GlassInput: Record<'light' | 'dark', TextStyle> = {
  light: {
    backgroundColor: 'rgba(255,255,255,0.40)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.58)',
  },
  dark: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
};

/** The wash behind a sheet or dialog — indigo-tinted, never flat black. */
export const Scrim = 'rgba(9,7,26,0.58)';

/**
 * The hero surface on the dashboard: glass with the accent pushed through it,
 * so the one card a screen is built around is tinted rather than just bigger.
 */
export const Hero: Record<'light' | 'dark', {
  tint: ViewStyle;
  inset: string;
  divider: string;
  glow: string;
}> = {
  light: {
    tint: {
      backgroundColor: 'rgba(124,92,255,0.16)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.72)',
      boxShadow: [
        { offsetX: 0, offsetY: 12, blurRadius: 38, color: 'rgba(80,50,200,0.18)' },
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.90)', inset: true },
      ],
    },
    inset: 'rgba(255,255,255,0.55)',
    divider: 'rgba(23,18,67,0.14)',
    glow: 'rgba(255,255,255,0.40)',
  },
  dark: {
    tint: {
      backgroundColor: 'rgba(124,92,255,0.20)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.20)',
      boxShadow: [
        { offsetX: 0, offsetY: 12, blurRadius: 38, color: 'rgba(0,0,0,0.46)' },
        { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.26)', inset: true },
      ],
    },
    inset: 'rgba(255,255,255,0.09)',
    divider: 'rgba(255,255,255,0.16)',
    glow: 'rgba(124,92,255,0.30)',
  },
};

/**
 * Accent colours offered in Settings.
 *
 * Each is dark enough to carry white text as a filled button (4.5:1) and
 * bright enough to read as a tint on glass in both themes. Teal and emerald
 * were retired with the Aurora look — anyone who had picked one falls back to
 * violet, which is the system's own accent.
 */
export const Accents = {
  violet: { label: 'Violet', color: '#6A45F5' },
  azure: { label: 'Azure', color: '#1F6FEB' },
  fuchsia: { label: 'Fuchsia', color: '#A734D9' },
  rose: { label: 'Rose', color: '#C2255C' },
  amber: { label: 'Amber', color: '#B45309' },
} as const;

export type AccentKey = keyof typeof Accents;

export const ACCENT_KEYS = Object.keys(Accents) as AccentKey[];

/** The system accent, and the fallback for anything unreadable. */
export const DEFAULT_ACCENT: AccentKey = 'violet';

/**
 * The accent as a TINT on glass, where the filled-button colours above are too
 * dark to read. Paired with `Accents` by key.
 */
export const AccentTints: Record<AccentKey, { light: string; dark: string }> = {
  violet: { light: '#5B3FD4', dark: '#B4A1FF' },
  azure: { light: '#1560CE', dark: '#8EC2FF' },
  fuchsia: { light: '#92279E', dark: '#E7A6FF' },
  rose: { light: '#AC1E50', dark: '#FF9CBE' },
  amber: { light: '#92400E', dark: '#FFC078' },
};

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

/**
 * One corner scale, so surfaces look like one family. Glass wants generous
 * radii — a tight corner reads as a plain box however it's filled.
 */
export const Radius = {
  /** Chips, pills, small controls. */
  small: 12,
  /** Buttons and inset rows. */
  medium: 16,
  /** The standard card. */
  card: 20,
  /** Heroes, sheets, the balance. */
  large: 26,
  /** Fully round. */
  full: 999,
} as const;

/**
 * The tab bar's own height, BEFORE the safe-area inset is added on top.
 *
 * react-navigation's default is 49dp and both the icon and the label have to
 * fit inside it, which they do not here. The row costs 60dp exactly — 8 top,
 * a 28dp icon slot, 2, a 14dp label, 8 bottom — so this is that plus a little
 * air. Change this and check `(tabs)/_layout.tsx` still adds up.
 */
export const TAB_BAR_HEIGHT = 64;

/**
 * Height the glass tab bar occupies, including its safe-area inset.
 *
 * The bar is translucent and ABSOLUTE, so content scrolls under it (that is
 * the whole point of glass chrome). Every scrolling screen therefore has to
 * pad its own bottom by this much, where before the navigator did it for them.
 * `TAB_BAR_HEIGHT` plus a typical bottom inset: 34 on iOS, ~24 for Android's
 * gesture handle.
 */
export const BottomTabInset =
  Platform.select({ ios: TAB_BAR_HEIGHT + 34, android: TAB_BAR_HEIGHT + 26 }) ?? TAB_BAR_HEIGHT + 26;

export const MaxContentWidth = 800;
