import { useSyncExternalStore } from 'react';

import { isPeerTyping, subscribeTyping } from '@/sync/typing';

/** True while the other member of the watched book is typing. */
export function usePeerTyping(): boolean {
  return useSyncExternalStore(subscribeTyping, isPeerTyping, isPeerTyping);
}
