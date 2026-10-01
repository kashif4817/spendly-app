/**
 * Is there a newer APK than the one installed?
 *
 * Spendly is installed from GitHub releases rather than a store, so nothing
 * tells the phone a new build exists. This asks the repo for its latest release
 * (see scripts/release.mjs) and compares that release's version with the
 * installed one.
 *
 * The answer is kept in AsyncStorage, so once a newer version is known the
 * update icon keeps showing — offline included — until it's actually installed.
 * Same module-store pattern as the appearance and week-start settings.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type AppRelease = {
  version: string;
  notes: string;
  /** The APK itself. */
  downloadUrl: string;
};

type ReleaseConfig = { repo?: string; apk?: string };

const config: ReleaseConfig = Constants.expoConfig?.extra?.release ?? {};

const STORAGE_KEY = 'spendly.release.latest';

/** GitHub allows 60 unauthenticated requests an hour; this stays well clear. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * The version of the build actually installed. runtimeVersion uses the
 * "appVersion" policy, so an OTA update only ever reaches a build of the same
 * version — the running manifest's version is the binary's.
 */
export const INSTALLED_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/** Numeric, part-by-part: 1.10.0 is newer than 1.9.3. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

let latest: AppRelease | null = null;
let lastChecked = 0;
let checking = false;

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

function setLatest(next: AppRelease | null): void {
  const same =
    next?.version === latest?.version &&
    next?.downloadUrl === latest?.downloadUrl &&
    next?.notes === latest?.notes;
  if (same) return;
  latest = next;
  emit();
  const write = next
    ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    : AsyncStorage.removeItem(STORAGE_KEY);
  write.catch(() => {
    // The in-memory value still applies for this session.
  });
}

// Hydrate once at startup, so a known update shows before the network answers.
(async () => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && !latest) {
      latest = JSON.parse(stored) as AppRelease;
      emit();
    }
  } catch {
    // Nothing cached — the first check will fill it in.
  }
})();

/** The newer release, or null when the installed build is current. */
export function getAvailableRelease(): AppRelease | null {
  return latest && compareVersions(latest.version, INSTALLED_VERSION) > 0 ? latest : null;
}

export function subscribeRelease(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Ask GitHub for the latest release. Throttled, and silent on failure: being
 * offline just means the cached answer stands.
 */
export async function checkForRelease(): Promise<void> {
  // APKs are Android-only, and without a repo there's nothing to ask.
  if (Platform.OS !== 'android' || !config.repo || !config.apk) return;
  if (checking || Date.now() - lastChecked < CHECK_INTERVAL_MS) return;

  checking = true;
  try {
    const res = await fetch(`https://api.github.com/repos/${config.repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) {
      // No releases at all (or the last one was deleted).
      setLatest(null);
    } else if (res.ok) {
      const body = (await res.json()) as {
        tag_name?: string;
        body?: string | null;
        assets?: { name: string; browser_download_url: string }[];
      };
      const version = (body.tag_name ?? '').replace(/^v/i, '');
      if (version) {
        const asset = body.assets?.find((a) => a.name === config.apk);
        setLatest({
          version,
          notes: (body.body ?? '').trim(),
          downloadUrl:
            asset?.browser_download_url ??
            `https://github.com/${config.repo}/releases/latest/download/${config.apk}`,
        });
      }
    }
    // Any other status (rate limit, server error) keeps what we had.
    lastChecked = Date.now();
  } catch {
    // Offline — try again next time the app comes to the front.
  } finally {
    checking = false;
  }
}
