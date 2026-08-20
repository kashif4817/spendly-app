/**
 * Which weekday the app treats as the start of a week — used by the dashboard
 * period filter, the weekly report and the month calendar grid.
 *
 * The choice is device-local and lives in AsyncStorage (like the reminder
 * prefs). It's mirrored in a tiny module store so screens can read it
 * synchronously and re-render the instant it changes.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_WEEK_START, type WeekStart } from '@/lib/date';

const STORAGE_KEY = 'spendly.weekStart';

export const WEEK_START_OPTIONS: { label: string; value: WeekStart }[] = [
  { label: 'Monday', value: 1 },
  { label: 'Sunday', value: 0 },
];

let current: WeekStart = DEFAULT_WEEK_START;
const listeners = new Set<() => void>();

function parse(stored: string | null): WeekStart | null {
  if (stored === '0') return 0;
  if (stored === '1') return 1;
  return null;
}

function emit(): void {
  listeners.forEach((fn) => fn());
}

// Hydrate once at startup. Until it resolves screens render with the default,
// which is also what a first-run user gets — so there's nothing to flash.
AsyncStorage.getItem(STORAGE_KEY)
  .then((stored) => {
    const saved = parse(stored);
    if (saved !== null && saved !== current) {
      current = saved;
      emit();
    }
  })
  .catch(() => {
    // Unreadable storage just means we keep the default.
  });

export function getWeekStart(): WeekStart {
  return current;
}

export function subscribeWeekStart(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Save the user's choice and re-render every screen that reads it. */
export function setWeekStart(value: WeekStart): void {
  if (value === current) return;
  current = value;
  emit();
  AsyncStorage.setItem(STORAGE_KEY, String(value)).catch(() => {
    // The in-memory value still applies for this session.
  });
}
