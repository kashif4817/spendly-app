/**
 * Which balances are covered, one counterparty at a time.
 *
 * A person or a shared book is a SCOPE, and each scope is covered on its own:
 * hiding what you owe your landlord shouldn't blank out the lunch money you're
 * tracking with a friend. Scopes are namespaced (`person:` / `book:`) because a
 * book id and a person's name are both free text and would otherwise collide.
 *
 * TWO SETS, because "private" and "showing right now" are different questions:
 *
 *   hidden   — the user's standing choice, persisted. Survives restarts.
 *   revealed — what's uncovered this session, in memory only. Cleared on a cold
 *              start and after the app has been away a while.
 *
 * A balance is covered when it's in `hidden` and not in `revealed`. With no PIN
 * set the second set is never used and showing a balance simply drops it from
 * `hidden`, so the eye is a plain on/off toggle. With a PIN required, showing
 * one is temporary — otherwise the PIN would be asked exactly once, ever.
 *
 * Device-local, in AsyncStorage and mirrored here so screens read it
 * synchronously and re-render the instant it changes — the same pattern as the
 * appearance and week-start settings. The secret itself is not here: whether a
 * PIN is required lives with the rest of the lock state in `lock/app-lock`, and
 * is pushed in by the lock provider.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { getLockConfig } from '@/lock/app-lock';

const HIDDEN_KEY = 'spendly.balance.hiddenScopes';

/** How long the app can be backgrounded before revealed balances re-cover. */
const GRACE_MS = 15_000;

/** What a screen must do before showing a figure. */
type PinRequest = { onUnlock: () => void };

/** A person's ledger, keyed by the name the entries are filed under. */
export function personScope(person: string): string {
  return `person:${person}`;
}

/** A shared book, keyed by its id rather than its name, which can be renamed. */
export function bookScope(bookId: string): string {
  return `book:${bookId}`;
}

/**
 * The two running totals, which are scopes in their own right.
 *
 * They used to cover themselves whenever any one person was covered, on the
 * reasoning that a total beside its visible parts gives the hidden one away.
 * That was the wrong trade: hiding one friend blanked the summary you keep the
 * screen open for. They get their own switches instead — the arithmetic is
 * still there for anyone who wants to do it, and that is the user's call to
 * make, not ours.
 */
export const TOTAL_RECEIVABLE_SCOPE = 'total:receivable';
export const TOTAL_PAYABLE_SCOPE = 'total:payable';

let hidden = new Set<string>();
let revealed = new Set<string>();
/** Mirrored from the lock config — a PIN exists AND balances are set to ask. */
let pinRequired = false;
let request: PinRequest | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function subscribeBalancePrivacy(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Is this one covered right now? */
export function isBalanceCovered(scope: string): boolean {
  return hidden.has(scope) && !revealed.has(scope);
}

function persist(): void {
  AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden])).catch(() => {
    // The in-memory value still applies for this session.
  });
}

/** Cover this balance, and stop showing it if it was uncovered. */
export function coverBalance(scope: string): void {
  revealed.delete(scope);
  if (!hidden.has(scope)) hidden.add(scope);
  persist();
  emit();
}

/** Uncover for good — the no-PIN path, where the eye is a plain toggle. */
export function showBalance(scope: string): void {
  const changed = hidden.delete(scope) || revealed.delete(scope);
  if (!changed) return;
  persist();
  emit();
}

/**
 * Uncover until the app is left alone — the PIN path. It stays in `hidden`, so
 * it covers itself again rather than quietly becoming public after one unlock.
 */
export function revealBalance(scope: string): void {
  if (revealed.has(scope)) return;
  revealed.add(scope);
  emit();
}

/**
 * Carry a scope's covered state across a rename.
 *
 * A person is keyed by name because that IS their identity here — entries are
 * filed under it. So renaming one would otherwise strand their scope and
 * quietly uncover the balance they had hidden, which is the one failure this
 * feature must not have. Books are keyed by id and never need this.
 */
export function renameBalanceScope(from: string, to: string): void {
  if (from === to) return;
  const wasHidden = hidden.delete(from);
  const wasRevealed = revealed.delete(from);
  if (!wasHidden && !wasRevealed) return;
  if (wasHidden) hidden.add(to);
  if (wasRevealed) revealed.add(to);
  persist();
  emit();
}

/**
 * The whole eye-tap policy in one place: cover immediately, uncover through the
 * PIN when one is required — and then only until the app is left alone.
 *
 * Takes `needsPin` rather than reading it, because the answer lives in the lock
 * context. Callers inside a component should prefer `useBalanceToggle`; this is
 * for the ones firing from a menu, where a hook can't go.
 */
export function toggleBalanceCover(scope: string, needsPin: boolean): void {
  if (!isBalanceCovered(scope)) {
    coverBalance(scope);
    return;
  }
  if (needsPin) askForBalancePin(() => revealBalance(scope));
  else showBalance(scope);
}

/** The pending "enter your PIN" ask, for the host mounted at the root. */
export function getBalancePinRequest(): PinRequest | null {
  return request;
}

/** Open the PIN ask. `onUnlock` runs only if the right PIN is entered. */
export function askForBalancePin(onUnlock: () => void): void {
  request = { onUnlock };
  emit();
}

export function dismissBalancePin(): void {
  if (!request) return;
  request = null;
  emit();
}

/**
 * Tell the store whether the PIN still guards balances. Called by the lock
 * provider on load and after any change in Settings.
 *
 * Turning it on re-covers everything showing: the switch is worthless if the
 * figures it was meant to protect stay on screen behind it.
 */
export function syncBalancePinRequired(on: boolean): void {
  pinRequired = on;
  if (!on || revealed.size === 0) return;
  revealed = new Set();
  emit();
}

// Hydrate once at startup, before anything has drawn a figure. `revealed`
// deliberately starts empty, so a private balance is covered on every cold
// start whether or not a PIN is involved.
(async () => {
  try {
    const [stored, config] = await Promise.all([AsyncStorage.getItem(HIDDEN_KEY), getLockConfig()]);
    pinRequired = config.balancePin && config.hasPin;
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return;
    const scopes = parsed.filter((s): s is string => typeof s === 'string');
    if (scopes.length === 0) return;
    hidden = new Set(scopes);
    emit();
  } catch {
    // Unreadable storage just means nothing is covered, as on a first run.
  }
})();

// Re-cover after the app has been away a while, on the same grace period the
// app lock uses — so handing someone your unlocked phone doesn't hand them the
// reveal you did an hour ago. Deliberately never unsubscribed: there is one
// store and it lives as long as the app does.
let backgroundedAt: number | null = null;

AppState.addEventListener('change', (state) => {
  if (state === 'background' || state === 'inactive') {
    if (backgroundedAt === null) backgroundedAt = Date.now();
    return;
  }
  if (state !== 'active') return;
  const since = backgroundedAt;
  backgroundedAt = null;
  if (!pinRequired || revealed.size === 0) return;
  if (since !== null && Date.now() - since > GRACE_MS) {
    revealed = new Set();
    emit();
  }
});
