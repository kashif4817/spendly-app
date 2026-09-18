/**
 * How the app looks: light/dark/system, and which accent colour it uses.
 *
 * Both are device-local and live in AsyncStorage, mirrored in a module store so
 * screens read them synchronously and re-render the instant they change. Same
 * pattern as the week-start and people-view settings.
 *
 * Deliberately not synced: which theme suits a phone is about that phone — its
 * screen, and whether it's dark in the room — not about the account.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { Accents, DEFAULT_ACCENT, type AccentKey } from '@/constants/theme';

const MODE_KEY = 'spendly.appearance.mode';
const ACCENT_KEY = 'spendly.appearance.accent';

/** 'system' follows the phone; the other two override it. */
export type AppearanceMode = 'system' | 'light' | 'dark';

export const DEFAULT_MODE: AppearanceMode = 'system';

export const MODE_OPTIONS: { label: string; value: AppearanceMode }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

const isMode = (value: string | null): value is AppearanceMode =>
  value === 'system' || value === 'light' || value === 'dark';

const isAccent = (value: string | null): value is AccentKey =>
  !!value && Object.prototype.hasOwnProperty.call(Accents, value);

let mode: AppearanceMode = DEFAULT_MODE;
let accent: AccentKey = DEFAULT_ACCENT;

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

// Hydrate once at startup. Until it resolves the app renders the defaults,
// which is also what a first run looks like — so there's nothing to flash.
(async () => {
  try {
    const [storedMode, storedAccent] = await Promise.all([
      AsyncStorage.getItem(MODE_KEY),
      AsyncStorage.getItem(ACCENT_KEY),
    ]);
    let changed = false;
    if (isMode(storedMode) && storedMode !== mode) {
      mode = storedMode;
      changed = true;
    }
    if (isAccent(storedAccent) && storedAccent !== accent) {
      accent = storedAccent;
      changed = true;
    }
    if (changed) emit();
  } catch {
    // Unreadable storage just means we keep the defaults.
  }
})();

export function getAppearanceMode(): AppearanceMode {
  return mode;
}

export function getAccentKey(): AccentKey {
  return accent;
}

export function subscribeAppearance(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Force light or dark, or hand the choice back to the phone. */
export function setAppearanceMode(value: AppearanceMode): void {
  if (value === mode) return;
  mode = value;
  emit();
  AsyncStorage.setItem(MODE_KEY, value).catch(() => {
    // The in-memory value still applies for this session.
  });
}

export function setAccentKey(value: AccentKey): void {
  if (value === accent) return;
  accent = value;
  emit();
  AsyncStorage.setItem(ACCENT_KEY, value).catch(() => {
    // The in-memory value still applies for this session.
  });
}
