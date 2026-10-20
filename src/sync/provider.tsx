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
  migratePersonFlagIds,
  outboxCount,
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
import { getLastSyncFailure, runSharedSync, runSync, type SyncFailure } from '@/sync/engine';
import { startRealtime, stopRealtime } from '@/sync/realtime';
import { readCachedUser } from '@/sync/session-cache';
import { clearUndo } from '@/lib/undo';

/** How often to retry a sync while the app is foregrounded (catches reconnects). */
const SYNC_INTERVAL_MS = 30_000;

/**
 * How long to wait after each consecutive failure before trying again.
 *
 * Without this, a phone with no connection re-ran the whole cycle every thirty
 * seconds, and every one of those attempts sat on a dead socket until the
 * request timed out. Anything that wanted a sync — opening a shared book above
 * all — queued up behind it. A user action still overrides the wait.
 */
const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

/** How long to gather up edits before sending them, so a burst goes up once. */
const EDIT_DEBOUNCE_MS = 1_200;

/** Which tables a cycle covers: everything, or just the shared books. */
type Lane = 'full' | 'shared';

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
  /** When the last successful cycle finished, or null if none has. */
  lastSyncedAt: Date | null;
  /** The last row the server refused, or null. Shown in Settings. */
  failure: SyncFailure | null;
  /** Continue with Google. Throws on failure; GOOGLE_CANCELLED when dismissed. */
  signInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
  syncNow: () => void;
  /**
   * Bring everything up to date and resolve with whether that worked.
   *
   * Pass `force` for something the user asked for by hand (a pull-to-refresh):
   * it waits out any cycle already running — which may have begun before the
   * data they care about reached the server — and ignores the offline
   * back-off. Without it, a cycle already in flight is shared, and an offline
   * phone answers `false` straight away instead of making the caller wait.
   */
  refreshNow: (force?: boolean) => Promise<boolean>;
  /**
   * The same, but only for shared books — three requests instead of ten.
   * Everything else in the app is this device's own data, which no amount of
   * fetching can change.
   */
  refreshShared: (force?: boolean) => Promise<boolean>;
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
  const [failure, setFailure] = useState<SyncFailure | null>(null);
  // The cycle currently running, if any. Callers that arrive mid-cycle share
  // it instead of starting a second one alongside.
  const inflight = useRef<Promise<boolean> | null>(null);
  // Consecutive failures, and the moment it's worth trying again. Reset by a
  // success, by the app coming back to the foreground, and by the socket
  // reconnecting — all three are evidence the network may be back.
  const failures = useRef(0);
  const nextAttempt = useRef(0);
  // The Google account photo, used as the avatar until the user uploads one.
  const googlePicture = useRef<string | null>(null);
  // Lets the realtime channel trigger a catch-up pull without being rebuilt
  // every time `sync` is recreated.
  const syncRef = useRef<(() => Promise<boolean>) | null>(null);

  // Stable: reads the active user from the db module, so it never goes stale
  // inside long-lived listeners.
  const start = useCallback((lane: Lane, force: boolean): Promise<boolean> => {
    const userId = getCurrentUserId();
    if (!userId) return Promise.resolve(false);
    // A cycle is already running: join it rather than open a second set of
    // requests against the same tables. The full lane covers the shared one.
    if (inflight.current) return inflight.current;
    // Offline and still inside the back-off. Answering straight away is the
    // whole point — the caller gets to show saved data instead of a spinner.
    if (!force && Date.now() < nextAttempt.current) return Promise.resolve(false);

    setStatus('syncing');
    const cycle = (lane === 'shared' ? runSharedSync(userId) : runSync(userId))
      .then((ok) => {
        setStatus(ok ? 'idle' : 'offline');
        if (ok) {
          failures.current = 0;
          nextAttempt.current = 0;
          setLastSyncedAt(new Date());
        } else {
          failures.current = Math.min(failures.current + 1, BACKOFF_MS.length);
          nextAttempt.current = Date.now() + BACKOFF_MS[failures.current - 1];
        }
        // Surfaced rather than swallowed: a row the server keeps refusing is a
        // bug to be read, not a silent "offline".
        setFailure(getLastSyncFailure());
        return ok;
      })
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = cycle;
    return cycle;
  }, []);

  /**
   * Run a cycle, optionally insisting on a fresh one.
   *
   * `force` waits out a cycle already in flight before starting its own, since
   * that one may have begun before the change the caller cares about reached
   * the server. Reserve it for something the user did on purpose.
   */
  const run = useCallback(
    async (lane: Lane, force = false): Promise<boolean> => {
      const current = inflight.current;
      if (current) {
        const ok = await current;
        if (!force) return ok;
      }
      return start(lane, force);
    },
    [start]
  );

  /** Clear the offline back-off — the network has just shown signs of life. */
  const resetBackoff = useCallback(() => {
    failures.current = 0;
    nextAttempt.current = 0;
  }, []);

  const sync = useCallback((): Promise<boolean> => run('full'), [run]);
  const refreshNow = useCallback((force = false): Promise<boolean> => run('full', force), [run]);
  const refreshShared = useCallback(
    (force = false): Promise<boolean> => run('shared', force),
    [run]
  );
  /** The Sync now button in Settings: always a fresh cycle, back-off or not. */
  const syncNow = useCallback(() => {
    void run('full', true);
  }, [run]);

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
      // The socket is up, so the network is: don't sit out a back-off built
      // up while it was down.
      failures.current = 0;
      nextAttempt.current = 0;
      void syncRef.current?.();
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
      if (localUser && localUser !== userId) {
        clearUndo();
        wipeLocalData();
      }

      setLocalUserId(userId);
      applyIdentity(user);
      // Claim any data created before this account signed in (e.g. pre-sync data).
      adoptUnassignedData(userId);
      // Re-key person flags that were saved under the old account-less id.
      migratePersonFlagIds(userId);

      // Best-effort profile row + default reminder + avatar (never block login).
      upsertProfile(userId, user.email ?? null, metaString(user, 'full_name', 'name')).catch(() => {});
      ensureDefaultReminder().catch(() => {});
      reloadAvatar();

      const synced = await run('full', true);

      // A brand-new account (nothing synced down) gets the default categories.
      // Only once a sync has actually completed: offline we can't tell "new
      // account" from "not pulled yet", and seeding then would duplicate the
      // categories the next pull brings down.
      if (synced && !hasAnyCategories()) {
        seedPresets(userId);
        await run('full', true);
      }

      // One-time: introduce presets added in a newer app version (e.g. the
      // hostel meal categories) to accounts that were created before them.
      // Bump the key suffix whenever the preset list grows to re-run this.
      try {
        if (!(await AsyncStorage.getItem(PRESETS_TOPUP_KEY))) {
          const added = seedMissingPresets(userId);
          await AsyncStorage.setItem(PRESETS_TOPUP_KEY, '1');
          if (added > 0) await run('full', true);
        }
      } catch {
        // non-critical — new presets can also be added by hand
      }
    },
    [run, reloadAvatar, applyIdentity]
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
        // Coming back to the app is a fresh chance for the network, so the
        // back-off starts over rather than making the user wait it out.
        resetBackoff();
        void sync();
        // A socket rarely survives a spell in the background. Reopening it
        // triggers a pull, which covers anything missed while it was down.
        if (getCurrentUserId()) {
          startRealtime(() => {
            resetBackoff();
            void syncRef.current?.();
          });
        }
      } else {
        // Don't hold a websocket open behind the user's back.
        stopRealtime();
      }
    });
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const dbSub = SQLite.addDatabaseChangeListener(() => {
      // A cycle writes to the database itself — draining the outbox, applying
      // pulled rows — and every one of those writes used to schedule another
      // cycle behind it. Only a change that leaves something queued for upload
      // is the user's, and only that is worth a sync.
      if (inflight.current) return;
      if (outboxCount() === 0) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        // The user just changed something: worth one attempt now, even mid
        // back-off, but it still rebuilds if that attempt fails too.
        resetBackoff();
        void sync();
      }, EDIT_DEBOUNCE_MS);
    });

    return () => {
      appSub.remove();
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      dbSub.remove();
    };
  }, [sync, resetBackoff]);

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
    clearUndo();
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
    failure,
    signInWithGoogle,
    logOut,
    syncNow,
    refreshNow,
    refreshShared,
    reloadAvatar,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
