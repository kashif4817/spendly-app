/**
 * Which user is signed in on this device, persisted in a tiny always-local
 * SQLite database (never synced) so login survives app restarts — you sign in
 * once, not every visit. Kept separate from the expense data so it can be read
 * synchronously at startup.
 */

import * as SQLite from 'expo-sqlite';

import { APP_DB } from '@/sync/config';

export type Session = {
  userId: number;
  email: string;
};

// Opened defensively: a failure here must never crash the app at import.
let app: SQLite.SQLiteDatabase | null = null;
try {
  app = SQLite.openDatabaseSync(APP_DB);
  app.execSync(`
    CREATE TABLE IF NOT EXISTS session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id INTEGER NOT NULL,
      email TEXT NOT NULL
    );
  `);
} catch {
  app = null; // session just won't persist; the app still runs
}

/** The signed-in user on this device, or null if signed out. */
export function getSession(): Session | null {
  if (!app) return null;
  const row = app.getFirstSync<{ user_id: number; email: string }>(
    'SELECT user_id, email FROM session WHERE id = 1'
  );
  return row ? { userId: row.user_id, email: row.email } : null;
}

export function saveSession(session: Session): void {
  app?.runSync(
    `INSERT INTO session (id, user_id, email) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id, email = excluded.email`,
    session.userId,
    session.email
  );
}

export function clearSession(): void {
  app?.runSync('DELETE FROM session WHERE id = 1');
}
