import { useSyncExternalStore } from 'react';

import { getRecentEmoji, subscribeRecentEmoji } from '@/lib/recent-emoji';

/** The emoji used most recently, re-rendering as the picker adds to them. */
export function useRecentEmoji(): string[] {
  return useSyncExternalStore(subscribeRecentEmoji, getRecentEmoji, getRecentEmoji);
}
