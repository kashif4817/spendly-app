/**
 * The emoji you have reached for lately, newest first.
 *
 * Device-local and in AsyncStorage, mirrored in a module store so the picker
 * reads it synchronously and re-renders the moment it changes — the same shape
 * as the week-start and people-view settings next door.
 *
 * WHY IT EXISTS: an emoji keyboard is a few hundred glyphs, and the handful a
 * person actually uses is a tiny, stable set. Without a recent row every send
 * starts with a hunt through tabs for the same five faces.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'spendly.recentEmoji';

/**
 * How many to keep.
 *
 * Two rows on a phone. More would push the one you want off the first glance,
 * which is the only thing this list is for.
 */
const LIMIT = 16;

let current: string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

// Hydrate once at startup. Until it resolves the picker shows an empty recent
// tab, which is also what a first-run user sees — so there is nothing to flash.
AsyncStorage.getItem(STORAGE_KEY)
  .then((stored) => {
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return;
    const saved = parsed.filter((item): item is string => typeof item === 'string');
    if (saved.length === 0) return;
    current = saved.slice(0, LIMIT);
    emit();
  })
  .catch(() => {
    // Unreadable or malformed storage just means we start with no history.
  });

export function getRecentEmoji(): string[] {
  return current;
}

export function subscribeRecentEmoji(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Record one that was just used.
 *
 * Moves it to the front rather than adding a second copy, so the row is a
 * most-recently-used list and not a tally of how often you send a thumbs up.
 */
export function recordRecentEmoji(emoji: string): void {
  const next = [emoji, ...current.filter((item) => item !== emoji)].slice(0, LIMIT);
  // Same emoji, already at the front: nothing moved, so nothing to tell anyone.
  if (next.length === current.length && next.every((item, i) => item === current[i])) return;

  current = next;
  emit();
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {
    // The in-memory list still applies for this session.
  });
}
