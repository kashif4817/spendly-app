import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { useAppearanceMode } from '@/hooks/use-appearance';

/**
 * As the native version, plus the hydration guard: to support static rendering
 * the value has to be recalculated on the client.
 */
export function useColorScheme(): 'light' | 'dark' {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const mode = useAppearanceMode();
  const colorScheme = useRNColorScheme();

  if (!hasHydrated) return 'light';
  if (mode === 'light' || mode === 'dark') return mode;
  return colorScheme === 'dark' ? 'dark' : 'light';
}
