/**
 * How the Loans list is ordered.
 *
 * WHY IT IS A CHOICE: the list answers two completely different questions
 * depending on why you opened it. "What happened lately" wants the most
 * recent first; "who owes me the most" and "who has been owing me longest"
 * want something else entirely, and until now the list could only ever
 * answer the first one.
 *
 * Device-local and in AsyncStorage, mirrored in a module store so the screen
 * reads it synchronously — the same shape as the view switch next door.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'spendly.peopleSort';

export type PeopleSort = 'recent' | 'amount' | 'oldest' | 'due' | 'name';

export const DEFAULT_PEOPLE_SORT: PeopleSort = 'recent';

/** The labels, in the order the chooser offers them. */
export const PEOPLE_SORTS: { key: PeopleSort; label: string; hint: string }[] = [
  { key: 'recent', label: 'Recent activity', hint: 'What moved last' },
  { key: 'amount', label: 'Biggest balance', hint: 'Most money outstanding first' },
  { key: 'oldest', label: 'Longest outstanding', hint: 'Owing the longest, first' },
  { key: 'due', label: 'Due soonest', hint: 'By the day it was promised back' },
  { key: 'name', label: 'Name', hint: 'A to Z' },
];

const isPeopleSort = (value: string | null): value is PeopleSort =>
  value === 'recent' ||
  value === 'amount' ||
  value === 'oldest' ||
  value === 'due' ||
  value === 'name';

let current: PeopleSort = DEFAULT_PEOPLE_SORT;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

// Hydrate once at startup. Until it resolves the list uses the default, which
// is also what a first-run user sees — so there is nothing to flash.
AsyncStorage.getItem(STORAGE_KEY)
  .then((stored) => {
    if (isPeopleSort(stored) && stored !== current) {
      current = stored;
      emit();
    }
  })
  .catch(() => {
    // Unreadable storage just means we keep the default.
  });

export function getPeopleSort(): PeopleSort {
  return current;
}

export function subscribePeopleSort(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setPeopleSort(value: PeopleSort): void {
  if (value === current) return;
  current = value;
  emit();
  AsyncStorage.setItem(STORAGE_KEY, value).catch(() => {
    // The in-memory value still applies for this session.
  });
}
