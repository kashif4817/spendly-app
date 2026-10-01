import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import {
  checkForRelease,
  getAvailableRelease,
  subscribeRelease,
  type AppRelease,
} from '@/lib/app-release';

/**
 * A newer APK than the installed one, or null. Checks on mount and whenever
 * the app comes back to the front (the check itself is throttled).
 */
export function useAppRelease(): AppRelease | null {
  const release = useSyncExternalStore(subscribeRelease, getAvailableRelease, getAvailableRelease);

  useEffect(() => {
    checkForRelease();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkForRelease();
    });
    return () => sub.remove();
  }, []);

  return release;
}
