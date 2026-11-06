/**
 * Books whose chat should stay quiet on this device.
 *
 * WHY DEVICE-LOCAL: muting is a statement about where you are, not about the
 * conversation. Syncing it would mean one person silencing the other's phone,
 * and it would also tell them you had done it — neither of which is what
 * anyone means by "mute".
 *
 * Read synchronously from a module store so the notification handler, which
 * must answer in the same tick, never has to await storage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'spendly.mutedBooks';

let muted = new Set<string>();
const listeners = new Set<() => void>();

/** A new Set each time it changes, so `useSyncExternalStore` sees a new identity. */
function emit(): void {
  listeners.forEach((fn) => fn());
}

// Hydrate once at startup. Until it resolves nothing is muted, which is also
// what a first run looks like — so there is nothing to flash.
AsyncStorage.getItem(STORAGE_KEY)
  .then((stored) => {
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return;
    const ids = parsed.filter((item): item is string => typeof item === 'string');
    if (ids.length === 0) return;
    muted = new Set(ids);
    emit();
  })
  .catch(() => {
    // Unreadable storage just means nothing is muted.
  });

export function isBookMuted(bookId: string): boolean {
  return muted.has(bookId);
}

export function getMutedBooks(): Set<string> {
  return muted;
}

export function subscribeMutedBooks(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Silence a book's chat on this device, or let it ring again. */
export function setBookMuted(bookId: string, mute: boolean): void {
  if (!bookId || muted.has(bookId) === mute) return;

  const next = new Set(muted);
  if (mute) next.add(bookId);
  else next.delete(bookId);
  muted = next;
  emit();

  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next])).catch(() => {
    // The in-memory set still applies for this session.
  });
}
