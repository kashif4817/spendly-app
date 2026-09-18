/**
 * How the Loans tab lays out the people list — cards, a two-column grid, or a
 * compact table.
 *
 * The choice is device-local (a phone and a tablet can sensibly want different
 * layouts) and lives in AsyncStorage, mirrored in a module store so the screen
 * reads it synchronously and re-renders the moment it changes. Same pattern as
 * the week-start setting.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'spendly.peopleView';

export type PeopleView = 'list' | 'grid';

export const DEFAULT_PEOPLE_VIEW: PeopleView = 'list';

const isPeopleView = (value: string | null): value is PeopleView =>
  value === 'list' || value === 'grid';

/**
 * Anyone left on the retired table view lands on the grid rather than being
 * stuck reading a stored value no switch can select any more.
 */
function migrate(stored: string | null): PeopleView | null {
  if (stored === 'table') return 'grid';
  return isPeopleView(stored) ? stored : null;
}

let current: PeopleView = DEFAULT_PEOPLE_VIEW;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

// Hydrate once at startup. Until it resolves the screen renders the default,
// which is also what a first-run user sees — so there's nothing to flash.
AsyncStorage.getItem(STORAGE_KEY)
  .then((stored) => {
    const saved = migrate(stored);
    if (saved && saved !== current) {
      current = saved;
      emit();
    }
  })
  .catch(() => {
    // Unreadable storage just means we keep the default.
  });

export function getPeopleView(): PeopleView {
  return current;
}

export function subscribePeopleView(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Save the chosen layout and re-render whatever is reading it. */
export function setPeopleView(value: PeopleView): void {
  if (value === current) return;
  current = value;
  emit();
  AsyncStorage.setItem(STORAGE_KEY, value).catch(() => {
    // The in-memory value still applies for this session.
  });
}
