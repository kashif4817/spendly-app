/**
 * Has this phone just picked up an over-the-air update?
 *
 * True for 24 hours after a phone FIRST runs a given update — counted from
 * that moment on this device, not from when the update was published, so a
 * phone that only fetches it two days later still says so. The dashboard's
 * version pill uses it to read "v1.1.2 · Updated", which is how you can tell
 * at a glance that an update reached a phone: the version number itself only
 * changes with a new APK (runtimeVersion follows the app version).
 *
 * Nothing shows for the code that shipped inside the APK — that isn't an
 * update arriving, and a new APK already changes the number.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';

const SEEN_KEY = 'spendly.update.firstSeen';
const SHOW_FOR_MS = 24 * 60 * 60 * 1000;

/** Worked out once per launch: the running update can't change mid-session. */
let answer: Promise<boolean> | null = null;

function runningUpdateId(): string | null {
  try {
    if (!Updates.isEnabled || Updates.isEmbeddedLaunch) return null;
    return Updates.updateId ?? null;
  } catch {
    return null;
  }
}

function check(): Promise<boolean> {
  if (answer) return answer;
  answer = (async () => {
    const id = runningUpdateId();
    if (!id) return false;

    let seen: { id: string; at: number } | null = null;
    try {
      const raw = await AsyncStorage.getItem(SEEN_KEY);
      seen = raw ? (JSON.parse(raw) as { id: string; at: number }) : null;
    } catch {
      seen = null;
    }

    if (seen?.id === id) return Date.now() - seen.at < SHOW_FOR_MS;

    // First launch of this update on this phone: the 24 hours start now.
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify({ id, at: Date.now() })).catch(() => {});
    return true;
  })();
  return answer;
}

export function useRecentUpdate(): boolean {
  const [recent, setRecent] = useState(false);
  useEffect(() => {
    let live = true;
    void check().then((value) => {
      if (live) setRecent(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return recent;
}
