/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { MoneyButtonColors, MoneyColors, MoneyTextColors } from '@/constants/app';
import { Accents, AccentTints, Colors, Glass, GlassInput, Hero, Mesh } from '@/constants/theme';
import { useAccentKey } from '@/hooks/use-appearance';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The palette in force, with the chosen accent and the glass system folded in.
 *
 * The accent lives here rather than in `Colors` because it's a runtime choice,
 * not a static table — and putting it on the theme object means every screen
 * that already calls useTheme() picks up a colour change for free. The glass
 * sets ride along for the same reason: a surface is `[styles.card, theme.glass]`
 * wherever it appears, with no per-screen wiring.
 */
export function useTheme() {
  const scheme = useColorScheme();
  const accentKey = useAccentKey();

  return {
    ...Colors[scheme],
    /** Which theme is in force — for the few places that must branch on it. */
    scheme,
    /** The accent as a FILL, dark enough to carry white text. */
    accent: Accents[accentKey].color,
    /** The accent as a TINT on glass: an icon, a mark, a small label. */
    accentTint: AccentTints[accentKey][scheme],
    /** Glass depths, spread onto a surface's style array. */
    glassWeak: Glass[scheme].weak,
    glass: Glass[scheme].base,
    glassStrong: Glass[scheme].strong,
    /** Heavier pane for sheets and dialogs sitting over a scrim. */
    glassOverlay: Glass[scheme].overlay,
    /** The same pane for a TextInput, which cannot take a ViewStyle. */
    glassInput: GlassInput[scheme],
    /** The accent-tinted hero surface, plus its inner parts. */
    hero: Hero[scheme],
    /** Money direction as a fill or a large amount. */
    money: MoneyColors,
    /** Money direction as small label text. */
    moneyText: MoneyTextColors[scheme],
    /** Money direction as a filled button behind a white label. */
    moneyButton: MoneyButtonColors,
    /** The app-wide mesh, painted by <AuroraBackground>. */
    mesh: Mesh[scheme],
  };
}
