import { useColorScheme as useSystemColorScheme } from 'react-native';

import { useAppearanceMode } from '@/hooks/use-appearance';

/**
 * The colour scheme actually in force.
 *
 * This wraps React Native's hook rather than re-exporting it, so the Settings
 * choice can override the phone: 'system' defers to the OS, 'light' and 'dark'
 * win. Everything in the app reads the scheme through here — importing
 * `useColorScheme` straight from react-native would quietly ignore the setting.
 */
export function useColorScheme(): 'light' | 'dark' {
  const mode = useAppearanceMode();
  const system = useSystemColorScheme();

  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'dark' ? 'dark' : 'light';
}
