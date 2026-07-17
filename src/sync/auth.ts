/**
 * Calls to the sync backend (the Cloudflare Worker). These only exchange an
 * email + password for the user's Turso database URL + a scoped token; all the
 * actual data movement happens on-device via the embedded replica.
 */

import { SYNC_BACKEND_URL, isSyncConfigured } from '@/sync/config';

export type Credentials = {
  dbUrl: string;
  dbToken: string;
  email: string;
};

/** A failed auth call, carrying the backend's machine-readable error code. */
export class AuthError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'AuthError';
  }
}

/** Turn a backend error code into a short, user-facing message. */
export function authErrorMessage(code: string): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Wrong email or password.';
    case 'email_taken':
      return 'That email already has an account. Try logging in.';
    case 'weak_password':
      return 'Password must be at least 6 characters.';
    case 'invalid_email':
      return 'That doesn’t look like an email address.';
    case 'not_configured':
      return 'Backup isn’t set up yet.';
    case 'network':
      return 'Couldn’t reach the server. Check your connection.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

async function post(path: '/signup' | '/login', email: string, password: string): Promise<Credentials> {
  if (!isSyncConfigured()) throw new AuthError('not_configured');

  let res: Response;
  try {
    res = await fetch(`${SYNC_BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new AuthError('network');
  }

  let body: Partial<Credentials> & { error?: string };
  try {
    body = await res.json();
  } catch {
    throw new AuthError('server_error');
  }

  if (!res.ok || !body.dbUrl || !body.dbToken) {
    throw new AuthError(body.error ?? 'server_error');
  }
  return { dbUrl: body.dbUrl, dbToken: body.dbToken, email: body.email ?? email };
}

export const signupRequest = (email: string, password: string) => post('/signup', email, password);
export const loginRequest = (email: string, password: string) => post('/login', email, password);
