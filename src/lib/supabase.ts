import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/sync/config';

/**
 * The shared Supabase client. Auth sessions are persisted in AsyncStorage and
 * refreshed automatically, so a signed-in user stays signed in across restarts
 * (and can open the app offline once they've logged in the first time).
 *
 * Fallback values keep `createClient` from throwing when the env vars are
 * missing; real network calls then simply fail and surface as "offline".
 */
/**
 * How long a request may hang before we give up. Without this a request made
 * on a dead connection can sit unresolved for a long time, holding up the sync
 * loop long after the network is back.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Requests that legitimately run long — receipt and avatar uploads. */
const isUpload = (url: string) => url.includes('/storage/v1/');

const fetchWithTimeout: typeof fetch = (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (isUpload(url)) return fetch(input, init);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Keep honouring a signal the caller passed in as well as our own.
  if (init?.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', () => controller.abort());
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
};

export const supabase = createClient(
  SUPABASE_URL || 'http://localhost',
  SUPABASE_ANON_KEY || 'public-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchWithTimeout },
  }
);
