/**
 * Wires Supabase Auth (Google only) + background sync into the app.
 *
 * On launch it restores the saved session (so you stay signed in, and the app
 * opens offline once you've signed in once). The only sign-in is "Continue with
 * Google" — a Google ID token is exchanged for a Supabase session. Sync is
 * silent and best-effort: on app foreground, shortly after any edit, and on a
 * timer — so offline entries upload themselves once the connection is back.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@supabase/supabase-js';
import * as SQLite from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  adoptUnassignedData,
  getCurrentUserId,
  getLocalUserId,
  hasAnyCategories,
  seedMissingPresets,
  seedPresets,
  setCurrentUserId,
  setLocalUserId,
  wipeLocalData,
} from '@/db';
import { googleSignInIdToken, googleSignOut, isGoogleConfigured } from '@/lib/google';
import { ensureDefaultReminder } from '@/lib/notifications';
import { avatarUrl as getSignedAvatarUrl, getAvatarPath, upsertProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { runSync } from '@/sync/engine';
import { startRealtime, stopRealtime } from '@/sync/realtime';
import { readCachedUser } from '@/sync/session-cache';

/** How often to retry a sync while the app is foregrounded (catches reconnects). */
const SYNC_INTERVAL_MS = 30_000;

/** Flag so the "add newly-introduced presets" top-up runs only once per device. */
const PRESETS_TOPUP_KEY = 'presets_topup_v2';

type SyncStatus = 'idle' | 'syncing' | 'offline';

type SyncContextValue = {
  /** False until the initial session restore has finished. */
  ready: boolean;
  /** Signed-in email, or null when signed out. */
  email: string | null;
  /** Signed-in user's display name (from Google), or null. */
  name: string | null;
  /** URL for the user's avatar (uploaded, else the Google photo), or null. */
  avatarUrl: string | null;
  status: SyncStatus;
  lastSyncedAt: Date | null;
  /** Continue with Google. Throws on failure; GOOGLE_CANCELLED when dismissed. */
  signInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  syncNow: () => void;
  /** Re-fetch the avatar (after the user changes it). */
  reloadAvatar: () => Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}

const metaString = (user: User, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = user.user_metadata?.[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
};

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const busy = useRef(false);
  // The Google account photo, used as the avatar until the user uploads one.
  const googlePicture = useRef<string | null>(null);
  // Lets the realtime channel trigger a catch-up pull without being rebuilt
  // every time `sync` is recreated.
  const syncRef = useRef<(() => Promise<boolean>) | null>(null);

  // Stable: reads the active user from the db module, so it never goes stale
  // inside long-lived listeners.
  const sync = useCallback(async (): Promise<boolean> => {
    const userId = getCurrentUserId();
    if (!userId || busy.current) return false;
    busy.current = true;
    setStatus('syncing');
    try {
      const ok = await runSync(userId);
      setStatus(ok ? 'idle' : 'offline');
      if (ok) setLastSyncedAt(new Date());
      return ok;
    } finally {
      busy.current = false;
    }
  }, []);

  // Kept in a ref (via an effect, not during render — the React Compiler is on)
  // so the realtime channel can trigger a catch-up pull without being rebuilt.
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  const reloadAvatar = useCallback(async () => {
    const uid = getCurrentUserId();
    if (!uid) {
      setAvatarUrl(googlePicture.current);
      return;
    }
    try {
      const path = await getAvatarPath(uid);
      setAvatarUrl(path ? await getSignedAvatarUrl(path) : googlePicture.current);
    } catch {
      setAvatarUrl(googlePicture.current);
    }
  }, []);

  /**
   * Adopt a user as the signed-in account — purely local state, no network.
   * Shared by the offline restore path and the full online setup below.
   */
  const applyIdentity = useCallback((user: User) => {
    setCurrentUserId(user.id);
    // Shared books go live as soon as we know who we are. Realtime only
    // delivers what RLS allows, so the session must be in place first.
    startRealtime(() => {
      syncRef.current?.();
    });
    // Show the Google account photo right away; reloadAvatar() upgrades to an
    // uploaded avatar if the user has set one.
    googlePicture.current = metaString(user, 'avatar_url', 'picture');
    setEmail(user.email ?? null);
    setName(metaString(user, 'full_name', 'name'));
    setAvatarUrl(googlePicture.current);
  }, []);

  const establishAccount = useCallback(
    async (user: User) => {
      const userId = user.id;

      // A different account on a device that already holds someone else's data:
      // start clean so their rows never mix.
      const localUser = getLocalUserId();
      if (localUser && localUser !== userId) wipeLocalData();

      setLocalUserId(userId);
      applyIdentity(user);
      // Claim any data created before this account signed in (e.g. pre-sync data).
      adoptUnassignedData(userId);

      // Best-effort profile row + default reminder + avatar (never block login).
      upsertProfile(userId, user.email ?? null, metaString(user, 'full_name', 'name')).catch(() => {});
      ensureDefaultReminder().catch(() => {});
      reloadAvatar();

      const synced = await sync();

      // A brand-new account (nothing synced down) gets the default categories.
      // Only once a sync has actually completed: offline we can't tell "new
      // account" from "not pulled yet", and seeding then would duplicate the
      // categories the next pull brings down.
      if (synced && !hasAnyCategories()) {
        seedPresets(userId);
        await sync();
      }

      // One-time: introduce presets added in a newer app version (e.g. the
      // hostel meal categories) to accounts that were created before them.
      // Bump the key suffix whenever the preset list grows to re-run this.
      try {
        if (!(await AsyncStorage.getItem(PRESETS_TOPUP_KEY))) {
          const added = seedMissingPresets(userId);
          await AsyncStorage.setItem(PRESETS_TOPUP_KEY, '1');
          if (added > 0) await sync();
        }
      } catch {
        // non-critical — new presets can also be added by hand
      }
    },
    [sync, reloadAvatar, applyIdentity]
  );

  // Restore the saved session on launch, and keep email in sync with auth events.
  useEffect(() => {
    let mounted = true;

    (async () => {
      // 1. Restore the account from storage first. This is local-only, so the
      //    app opens straight into the user's data with no connection —
      //    `getSession()` below can take a while offline (it refreshes an
      //    expired token over the network) and would otherwise strand an
      //    already-signed-in user on a spinner, then on the sign-in screen.
      const cached = await readCachedUser();
      // Only trust it when this device's data actually belongs to that account,
      // so a stale session can never surface someone else's entries.
      if (mounted && cached && getLocalUserId() === cached.id) {
        applyIdentity(cached);
      }
      if (mounted) setReady(true);

      // 2. Reconcile with Supabase in the background: refreshes the token,
      //    picks up profile changes and runs the first sync. Offline this just
      //    fails quietly and the restored identity above stands.
      try {
        const { data } = await supabase.auth.getSession();
        if (mounted && data.session?.user) {
          await establishAccount(data.session.user);
        }
      } catch {
        // offline or misconfigured — retried on the next foreground/sync tick
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setEmail(null);
        setName(null);
      } else if (session?.user) {
        setEmail(session.user.email ?? null);
        setName(metaString(session.user, 'full_name', 'name'));
        // Keep the Google photo as the fallback avatar, without clobbering an
        // uploaded one that reloadAvatar() may have already set.
        const pic = metaString(session.user, 'avatar_url', 'picture');
        googlePicture.current = pic;
        setAvatarUrl((prev) => prev ?? pic);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [establishAccount, applyIdentity]);

  // Background sync triggers: app foreground, a debounced tick after any edit,
  // and a periodic retry so offline changes go up when the connection returns.
  useEffect(() => {
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        sync();
        // A socket rarely survives a spell in the background. Reopening it
        // triggers a pull, which covers anything missed while it was down.
        if (getCurrentUserId()) startRealtime(() => void sync());
      } else {
        // Don't hold a websocket open behind the user's back.
        stopRealtime();
      }
    });
    const timer = setInterval(sync, SYNC_INTERVAL_MS);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const dbSub = SQLite.addDatabaseChangeListener(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(sync, 1000);
    });

    return () => {
      appSub.remove();
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      dbSub.remove();
    };
  }, [sync]);

  const signInWithGoogle = useCallback(async () => {
    if (!isGoogleConfigured()) {
      throw new Error('Google sign-in isn’t set up yet (missing Web client ID).');
    }
    const idToken = await googleSignInIdToken();
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('Google sign-in failed. Please try again.');
    await establishAccount(data.user);
  }, [establishAccount]);

  const logOut = useCallback(async () => {
    stopRealtime();
    await googleSignOut();
    try {
      await supabase.auth.signOut();
    } catch {
      // Offline: the revoke call couldn't go out. Drop the session locally
      // anyway, otherwise it stays in storage and the restore above would sign
      // the user straight back in on the next launch.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
    setCurrentUserId(null);
    googlePicture.current = null;
    setEmail(null);
    setName(null);
    setAvatarUrl(null);
    setStatus('idle');
  }, []);

  const value: SyncContextValue = {
    ready,
    email,
    name,
    avatarUrl,
    status,
    lastSyncedAt,
    signInWithGoogle,
    logOut,
    syncNow: sync,
    reloadAvatar,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
