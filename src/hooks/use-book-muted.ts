import { useSyncExternalStore } from 'react';

import { getMutedBooks, subscribeMutedBooks } from '@/lib/muted-books';

/** True while this device is keeping the given book's chat quiet. */
export function useBookMuted(bookId: string): boolean {
  const muted = useSyncExternalStore(subscribeMutedBooks, getMutedBooks, getMutedBooks);
  return muted.has(bookId);
}
