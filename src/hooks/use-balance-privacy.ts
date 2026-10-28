import { useCallback, useSyncExternalStore } from 'react';

import {
  getBalancePinRequest,
  isBalanceCovered,
  subscribeBalancePrivacy,
  toggleBalanceCover,
} from '@/lib/balance-privacy';
import { useLock } from '@/lock/provider';

/**
 * Is this one counterparty's money covered?
 *
 * The answer every row and figure wants. It deliberately doesn't touch the lock
 * context, so a list of forty rows costs forty boolean reads and nothing more.
 */
export function useBalanceCovered(scope: string): boolean {
  return useSyncExternalStore(
    subscribeBalancePrivacy,
    () => isBalanceCovered(scope),
    () => isBalanceCovered(scope)
  );
}

/**
 * The same answer plus the control, for the places that draw the eye.
 *
 * `toggle` holds the whole policy so no caller has to remember it: covering is
 * immediate, and uncovering goes through the PIN when the setting is on — and
 * is then temporary, so it re-covers itself rather than silently becoming
 * public after one unlock.
 */
export function useBalanceToggle(scope: string) {
  const covered = useBalanceCovered(scope);
  const { balancePin, hasPin } = useLock();
  const needsPin = balancePin && hasPin;

  const toggle = useCallback(() => toggleBalanceCover(scope, needsPin), [needsPin, scope]);

  return { covered, needsPin, toggle };
}

/** The pending PIN ask, for the host mounted at the root. */
export function useBalancePinRequest() {
  return useSyncExternalStore(subscribeBalancePrivacy, getBalancePinRequest, getBalancePinRequest);
}
