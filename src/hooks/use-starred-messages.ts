import { useSyncExternalStore } from 'react';

import { getStarredMessages, subscribeStarredMessages } from '@/lib/starred-messages';

/** The ids of messages kept on this device, re-rendering as they change. */
export function useStarredMessages(): Set<string> {
  return useSyncExternalStore(subscribeStarredMessages, getStarredMessages, getStarredMessages);
}
