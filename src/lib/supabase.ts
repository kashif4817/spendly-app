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
  }
);
