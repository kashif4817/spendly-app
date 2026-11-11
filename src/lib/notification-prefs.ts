/**
 * Which shared-book notifications this phone wants — the switches on the
 * Notifications screen.
 *
 * EVERY SWITCH IS ON BY DEFAULT. The store holds what has been turned OFF, so
 * a kind added in a later version starts on for everyone, with nothing to
 * migrate.
 *
 * DEVICE-LOCAL, like muting a book: what is welcome on one phone isn't a fact
 * about the account. It is also mirrored onto this install's own push_tokens
 * row (lib/push.ts), because the SERVER is who sends these — and when the app
 * is closed Android shows a push without asking the app first, so a switch
 * only the app knew about could never silence anything. That row is own-row
 * only, so the other member never learns what you turned off.
 *
 * Read synchronously from a module store, so the foreground handler — which
 * has to answer in the same tick — never awaits storage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** One per notification the server sends (supabase/notifications.sql). */
export type NotifyEvent =
  | 'message'
  | 'reminder'
  | 'reaction'
  | 'entry_added'
  | 'entry_edited'
  | 'entry_deleted'
  | 'joined';

export type NotifyGroup = 'Chat' | 'Entries' | 'Members';

/** The switches, in the order and groups the screen shows them. */
export const NOTIFY_OPTIONS: {
  event: NotifyEvent;
  group: NotifyGroup;
  label: string;
  hint: string;
}[] = [
  { event: 'message', group: 'Chat', label: 'Messages', hint: 'When they send you a message' },
  {
    event: 'reminder',
    group: 'Chat',
    label: 'Balance reminders',
    hint: 'When they remind you about the balance',
  },
  { event: 'reaction', group: 'Chat', label: 'Reactions', hint: 'When they react to your message' },
  {
    event: 'entry_added',
    group: 'Entries',
    label: 'New entries',
    hint: 'When they add one — directly or by splitting a bill',
  },
  { event: 'entry_edited', group: 'Entries', label: 'Edited entries', hint: 'When they change an amount, note, date or who paid' },
  { event: 'entry_deleted', group: 'Entries', label: 'Deleted entries', hint: 'When they delete one' },
  { event: 'joined', group: 'Members', label: 'Someone joins', hint: 'When someone joins your shared book' },
];

const STORAGE_KEY = 'spendly.notify.off';
const KNOWN = new Set<string>(NOTIFY_OPTIONS.map((option) => option.event));

let off = new Set<NotifyEvent>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

// Hydrate once at startup. Until it resolves everything is on, which is also
// what a first run looks like — so there is nothing to flash.
AsyncStorage.getItem(STORAGE_KEY)
  .then((stored) => {
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return;
    // Unknown names are dropped: a kind that no longer exists can't be "off".
    const events = parsed.filter(
      (item): item is NotifyEvent => typeof item === 'string' && KNOWN.has(item)
    );
    if (events.length === 0) return;
    off = new Set(events);
    emit();
  })
  .catch(() => {
    // Unreadable storage just means everything stays on.
  });

/**
 * Whether this phone wants this kind of notification. Anything it doesn't
 * recognise — a kind from a newer server — counts as on.
 */
export function isNotifyEnabled(event: string): boolean {
  return !off.has(event as NotifyEvent);
}

/** The switches currently off. A new Set each time it changes. */
export function getNotifyOff(): Set<NotifyEvent> {
  return off;
}

export function subscribeNotifyPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Turn one kind of notification on or off for this phone. */
export function setNotifyEnabled(event: NotifyEvent, enabled: boolean): void {
  if (off.has(event) === !enabled) return;

  const next = new Set(off);
  if (enabled) next.delete(event);
  else next.add(event);
  off = next;
  emit();

  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next])).catch(() => {
    // The in-memory set still applies for this session.
  });
}
