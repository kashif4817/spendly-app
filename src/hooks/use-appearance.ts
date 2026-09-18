import { useSyncExternalStore } from 'react';

import { Accents, type AccentKey } from '@/constants/theme';
import {
  getAccentKey,
  getAppearanceMode,
  subscribeAppearance,
  type AppearanceMode,
} from '@/lib/appearance';

/** Light, dark, or follow the phone — re-rendering when the user changes it. */
export function useAppearanceMode(): AppearanceMode {
  return useSyncExternalStore(subscribeAppearance, getAppearanceMode, getAppearanceMode);
}

/** The chosen accent's key (use `useTheme().accent` for the colour itself). */
export function useAccentKey(): AccentKey {
  return useSyncExternalStore(subscribeAppearance, getAccentKey, getAccentKey);
}

/** The accent colour currently in force. */
export function useAccent(): string {
  return Accents[useAccentKey()].color;
}
