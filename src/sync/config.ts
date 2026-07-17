/**
 * Cloud sync configuration.
 *
 * Secrets are read from EXPO_PUBLIC_* env vars (see .env.local, which is
 * gitignored) so they ship in the app bundle but never land in the public repo.
 *
 * Two modes, in order of precedence:
 *   1. Direct   — EXPO_PUBLIC_TURSO_URL + _TOKEN point straight at one Turso
 *                 database. Simplest: syncs automatically, no login. Good for a
 *                 single user / personal backup.
 *   2. Accounts — EXPO_PUBLIC_SYNC_URL points at the Cloudflare Worker, which
 *                 gives each signed-in user their own database (see sync-worker/).
 *
 * With neither set, the app runs exactly as before — fully offline.
 */

/** Direct-mode Turso database URL, e.g. "libsql://your-db.turso.io". */
export const TURSO_URL = (process.env.EXPO_PUBLIC_TURSO_URL ?? '').trim();

/** Direct-mode Turso database auth token. */
export const TURSO_TOKEN = (process.env.EXPO_PUBLIC_TURSO_TOKEN ?? '').trim();

/** Accounts-mode Cloudflare Worker base URL. */
export const SYNC_BACKEND_URL = (process.env.EXPO_PUBLIC_SYNC_URL ?? '').trim();

/** Local SQLite file for the offline-first data (used before any sync). */
export const DATA_LOCAL_DB = 'expenses.db';

/** Local file backing the embedded replica of the Turso database. */
export const DATA_CLOUD_DB = 'spendly-cloud.db';

/** Tiny always-local DB holding the login session (never synced). */
export const APP_DB = 'spendly-app.db';

/** Direct single-database mode: sync automatically, no login. */
export const isDirectSync = () => TURSO_URL.length > 0 && TURSO_TOKEN.length > 0;

/** Accounts mode: a backend URL is configured. */
export const isSyncConfigured = () => SYNC_BACKEND_URL.length > 0;
