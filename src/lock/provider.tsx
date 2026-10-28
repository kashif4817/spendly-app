/**
 * Owns the "is the app currently locked?" state. The app locks on a cold start
 * (if App Lock is on) and again after it's been in the background longer than a
 * short grace period, so quick app-switches don't nag but leaving the app does.
 *
 * It also holds the lock CONFIG for the rest of the app to read synchronously —
 * SecureStore is async, and a balance that had to await a disk read before it
 * knew whether to cover itself would flash the figure first.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getCurrentUserId } from '@/db';
import { googleSignInIdToken } from '@/lib/google';
import { supabase } from '@/lib/supabase';
import { syncBalancePinRequired } from '@/lib/balance-privacy';
import { forgetPin, getLockConfig, promptBiometric, verifyPin, type LockConfig } from '@/lock/app-lock';

/** How long the app can be backgrounded before it re-locks. */
const GRACE_MS = 15_000;

type LockContextValue = {
  ready: boolean;
  /** A PIN exists, so either switch below can be turned on. */
  hasPin: boolean;
  enabled: boolean;
  biometric: boolean;
  /** Showing a hidden balance asks for the PIN. */
  balancePin: boolean;
  isLocked: boolean;
  /** Reload config after the user changes lock settings. */
  refresh: () => Promise<LockConfig>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  tryBiometric: () => Promise<boolean>;
  /** Forgot-PIN recovery: re-verify with Google, then forget the PIN. */
  forgotUnlock: () => Promise<boolean>;
};

const LockContext = createContext<LockContextValue | null>(null);

export function useLock(): LockContextValue {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error('useLock must be used inside <LockProvider>');
  return ctx;
}

export function LockProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<LockConfig>({
    hasPin: false,
    enabled: false,
    biometric: false,
    balancePin: false,
  });
  const [isLocked, setIsLocked] = useState(false);

  const enabledRef = useRef(false);
  const backgroundedAt = useRef<number | null>(null);
  enabledRef.current = config.enabled;

  const refresh = useCallback(async () => {
    const c = await getLockConfig();
    setConfig(c);
    // The balance store runs its own re-hide timer and has to know whether the
    // PIN still guards anything, so every config change is pushed to it.
    syncBalancePinRequired(c.balancePin && c.hasPin);
    return c;
  }, []);

  useEffect(() => {
    (async () => {
      const c = await getLockConfig();
      setConfig(c);
      syncBalancePinRequired(c.balancePin && c.hasPin);
      setIsLocked(c.enabled && c.hasPin); // lock on cold start when App Lock is on
      setReady(true);
    })();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
      } else if (state === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (enabledRef.current && since !== null && Date.now() - since > GRACE_MS) {
          setIsLocked(true);
        }
      }
    });
    return () => sub.remove();
  }, []);

  const unlockWithPin = useCallback(async (pin: string) => {
    const ok = await verifyPin(pin);
    if (ok) setIsLocked(false);
    return ok;
  }, []);

  const tryBiometric = useCallback(async () => {
    const ok = await promptBiometric();
    if (ok) setIsLocked(false);
    return ok;
  }, []);

  const forgotUnlock = useCallback(async () => {
    try {
      const idToken = await googleSignInIdToken();
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      // Only the account that's actually signed in may turn the lock off.
      if (error || !data.user || data.user.id !== getCurrentUserId()) return false;
      await forgetPin();
      await refresh();
      setIsLocked(false);
      return true;
    } catch {
      return false;
    }
  }, [refresh]);

  const value: LockContextValue = {
    ready,
    hasPin: config.hasPin,
    enabled: config.enabled,
    biometric: config.biometric,
    balancePin: config.balancePin,
    isLocked,
    refresh,
    unlockWithPin,
    tryBiometric,
    forgotUnlock,
  };

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}
