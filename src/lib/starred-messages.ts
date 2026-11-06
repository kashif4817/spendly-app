/**
 * Messages you have kept, on this device.
 *
 * WHY DEVICE-LOCAL: starring is a bookmark, not a statement about the
 * message. Syncing it would put your private shortlist on the other person's
 * phone, and tell them which of their lines you had singled out.
 *
 * Stored as a flat set of message ids rather than per book: a star is looked
 * up once per visible bubble, and one set answers that in constant time
 * whichever thread is open.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'spendly.starredMessages';

/** Enough to be a shortlist; past this it is just the thread again. */
const LIMIT = 500;

let starred = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

AsyncStorage.getItem(STORAGE_KEY)
  .then((stored) => {
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return;
    const ids = parsed.filter((item): item is string => typeof item === 'string');
    if (ids.length === 0) return;
    starred = new Set(ids);
    emit();
  })
  .catch(() => {
    // Unreadable storage just means nothing is starred.
  });

export function getStarredMessages(): Set<string> {
  return starred;
}

export function isMessageStarred(id: string): boolean {
  return starred.has(id);
}

export function subscribeStarredMessages(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Keep a message, or let it go. */
export function setMessageStarred(id: string, star: boolean): void {
  if (!id || starred.has(id) === star) return;

  const next = new Set(starred);
  if (star) {
    next.add(id);
    // Oldest out first. A cap that refused new stars instead would make the
    // feature quietly stop working with no way to tell why.
    if (next.size > LIMIT) next.delete(next.values().next().value as string);
  } else {
    next.delete(id);
  }
  starred = next;
  emit();

  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next])).catch(() => {
    // The in-memory set still applies for this session.
  });
}
