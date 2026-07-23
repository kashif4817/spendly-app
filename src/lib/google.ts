/**
 * Native "Continue with Google" sign-in. Returns a Google ID token, which the
 * app then hands to Supabase (`signInWithIdToken`) to create/restore the session.
 * Requires the Google *Web* client ID (see GOOGLE_SETUP.md).
 */

import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';

import { GOOGLE_WEB_CLIENT_ID } from '@/sync/config';

GoogleSignin.configure({
  webClientId: GOOGLE_WEB_CLIENT_ID,
});

/** Thrown when the user closes the Google sheet without picking an account. */
export const GOOGLE_CANCELLED = 'google_cancelled';

/** True once the Web client ID is configured. */
export const isGoogleConfigured = () => GOOGLE_WEB_CLIENT_ID.length > 0;

/** Run the native Google account picker and return an ID token for Supabase. */
export async function googleSignInIdToken(): Promise<string> {
  if (!GOOGLE_WEB_CLIENT_ID) {
    // Empty Web client ID = the build didn't get EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.
    throw new Error('No Web client ID in this build (EAS env var missing).');
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) throw new Error(GOOGLE_CANCELLED);
    const idToken = response.data.idToken;
    if (!idToken) throw new Error('Google returned no ID token.');
    return idToken;
  } catch (e) {
    if (e instanceof Error && e.message === GOOGLE_CANCELLED) throw e;
    // Surface the native status code (e.g. DEVELOPER_ERROR = SHA-1/client mismatch)
    // so setup problems are diagnosable instead of hidden behind a generic message.
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) throw new Error(GOOGLE_CANCELLED);
      throw new Error(`Google: ${String(e.code)}${e.message ? ` — ${e.message}` : ''}`);
    }
    throw e;
  }
}

export async function googleSignOut(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // ignore — already signed out
  }
}
