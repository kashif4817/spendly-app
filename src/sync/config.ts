/**
 * Cloud sync configuration.
 *
 * Secrets are read from EXPO_PUBLIC_* env vars (see .env.local, which is
 * gitignored) so they ship in the app bundle but never land in the public repo.
 * With neither set, the app can't sign in — sync is effectively off.
 */

/** Supabase project URL, e.g. "https://xxxx.supabase.co". */
export const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();

/** Supabase anon (public) key. Safe to ship — Row Level Security guards the data. */
export const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

/** True once both Supabase env vars are present. */
export const isSyncConfigured = () => SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/**
 * Google OAuth *Web* client ID (from Google Cloud Console). Used both to request
 * a Google ID token on-device and by Supabase's Google provider. See GOOGLE_SETUP.md.
 */
export const GOOGLE_WEB_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();

/** Max rows fetched per table per pull request (Supabase caps at 1000). */
export const PULL_BATCH_SIZE = 1000;
