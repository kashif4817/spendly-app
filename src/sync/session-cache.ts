/**
 * Reads the signed-in user straight out of the persisted Supabase session,
 * with no network call.
 *
 * `supabase.auth.getSession()` looks local but isn't: once the access token is
 * past its (one hour) expiry it refreshes over the wire, and offline that
 * retries with backoff before finally resolving to "no session" — which reads
 * as *signed out* to the rest of the app. Reading the stored session directly
 * lets the app open instantly and offline, while the real session refresh
 * happens in the background.
 *
 * The storage format is supabase-js's own: a JSON `Session` under
 * `sb-<project-ref>-auth-token`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@supabase/supabase-js';

import { SUPABASE_URL } from '@/sync/config';

/** The AsyncStorage key supabase-js persists this project's session under. */
function sessionKey(): string | null {
  if (!SUPABASE_URL) return null;
  const host = SUPABASE_URL.replace(/^https?:\/\//, '').split('/')[0];
  const ref = host.split('.')[0];
  return ref ? `sb-${ref}-auth-token` : null;
}

function isUser(value: unknown): value is User {
  return !!value && typeof (value as User).id === 'string';
}

/**
 * The last signed-in user as persisted on this device, or null if there isn't
 * one. Never touches the network and never throws.
 */
export async function readCachedUser(): Promise<User | null> {
  const key = sessionKey();
  if (!key) return null;

  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    // Current format stores the session at the top level; older releases nested
    // it under `currentSession`.
    const user = parsed?.user ?? parsed?.currentSession?.user;
    if (isUser(user)) return user;

    // With the `userStorage` option the user is split into its own record.
    const rawUser = await AsyncStorage.getItem(`${key}-user`);
    if (!rawUser) return null;
    const split = JSON.parse(rawUser)?.user;
    return isUser(split) ? split : null;
  } catch {
    return null; // unreadable or malformed — treat as signed out
  }
}
