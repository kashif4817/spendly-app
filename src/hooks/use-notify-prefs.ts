import { useSyncExternalStore } from 'react';

import { getNotifyOff, subscribeNotifyPrefs, type NotifyEvent } from '@/lib/notification-prefs';

/** The notification switches turned OFF on this phone, re-rendering on change. */
export function useNotifyOff(): Set<NotifyEvent> {
  return useSyncExternalStore(subscribeNotifyPrefs, getNotifyOff, getNotifyOff);
}
