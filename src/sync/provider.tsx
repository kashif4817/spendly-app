/**
 * Wires cloud sync + login into the app.
 *
 * On launch it connects to the shared Turso database (an embedded replica),
 * then restores the saved session so you're signed in without logging in again.
 * Login/signup are checked locally against the synced `users` table. Sync is
 * best-effort and silent — on app foreground and whenever the data changes;
 * offline is a no-op, not an error.
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as SQLite from 'expo-sqlite';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  activateCloudDatabase,
  isCloudActive,
  loginUser,
  setCurrentUserId,
  signupUser,
  syncCloudNow,
} from '@/db';
import { isDirectSync, TURSO_TOKEN, TURSO_URL } from '@/sync/config';
import { clearSession, getSession, saveSession } from '@/sync/session';

// Cloud sync needs libSQL, which exists in a real build (dev or release) but NOT
// in Expo Go. Gate on that rather than __DEV__ so a local dev build can sync.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type SyncStatus = 'idle' | 'syncing' | 'offline';

type SyncContextValue = {
  /** False until the initial connect + session restore has finished. */
  ready: boolean;
  /** Signed-in email, or null when signed out. */
  email: string | null;
  status: SyncStatus;
  lastSyncedAt: Date | null;
  signUp: (email: string, password: string) => Promise<void>;
  logIn: (email: string, password: string) => Promise<void>;
  logOut: () => void;
  syncNow: () => void;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const busy = useRef(false);

  const runSync = useRef(async () => {
    if (!isCloudActive() || busy.current) return;
    busy.current = true;
    setStatus('syncing');
    const ok = await syncCloudNow();
    setStatus(ok ? 'idle' : 'offline');
    if (ok) setLastSyncedAt(new Date());
    busy.current = false;
  }).current;

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      // Connect to the shared database. Skipped only in Expo Go, which has no
      // libSQL — auth there runs against the local database, without cloud sync.
      if (!isExpoGo && isDirectSync()) {
        try {
          await activateCloudDatabase(TURSO_URL, TURSO_TOKEN);
        } catch {
          // no useLibSQL in this build — stay local
        }
      }
      if (cancelled) return;

      const session = getSession();
      if (session) {
        setCurrentUserId(session.userId);
        setEmail(session.email);
      }
      setReady(true);
      runSync();
    };
    boot();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(runSync, 800);
    };
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') runSync();
    });
    const dbSub = SQLite.addDatabaseChangeListener(debounced);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      appSub.remove();
      dbSub.remove();
    };
  }, [runSync]);

  const enter = (user: { id: number; email: string }) => {
    saveSession({ userId: user.id, email: user.email });
    setCurrentUserId(user.id);
    setEmail(user.email);
    runSync();
  };

  const value: SyncContextValue = {
    ready,
    email,
    status,
    lastSyncedAt,
    signUp: async (e, p) => enter(signupUser(e, p)),
    logIn: async (e, p) => enter(loginUser(e, p)),
    logOut: () => {
      clearSession();
      setCurrentUserId(null);
      setEmail(null);
    },
    syncNow: runSync,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
