/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useAccent } from '@/hooks/use-appearance';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The palette in force, with the chosen accent folded in as `theme.accent`.
 *
 * The accent lives here rather than in `Colors` because it's a runtime choice,
 * not a static table — and putting it on the theme object means every screen
 * that already calls useTheme() picks up a colour change for free.
 */
export function useTheme() {
  const scheme = useColorScheme();
  const accent = useAccent();

  return { ...Colors[scheme], accent };
}
