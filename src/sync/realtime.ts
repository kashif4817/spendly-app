/**
 * Live updates for shared books, over Supabase Realtime.
 *
 * WHAT THIS IS AND ISN'T: Realtime is fast *delivery*, not the source of truth.
 * A websocket dies when the phone sleeps, changes networks, or loses signal,
 * and anything that happened meanwhile is simply never delivered — there is no
 * replay. So this sits on top of the cursor-based pull in sync/shared.ts and
 * never replaces it:
 *
 *   • an event arrives  → apply that one row immediately (feels instant)
 *   • (re)subscribed    → run a full pull (catches whatever the socket missed)
 *
 * Drop either half and you get a ledger that is usually right, which for money
 * is the worst kind of wrong.
 *
 * Rows are applied through the same `applyRemoteRows` the pull uses, so they
 * get the same last-write-wins check and the same protection for local edits
 * that haven't been pushed yet.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import {
  applyRemoteRows,
  getCurrentUserId,
  getSharedBook,
  getSharedMemberName,
  markBooksDelivered,
  SHARED_TABLES,
  type SharedMessage,
  type SharedTable,
} from '@/db';
import { presentChatMessage } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

let channel: RealtimeChannel | null = null;

/**
 * True only while the server has confirmed the subscription.
 *
 * `channel !== null` says we asked to listen; this says the other phone's
 * entries are actually reaching us. That distinction is what lets a screen
 * skip a round trip: if the socket is live and a pull has run since it came
 * up, there is nothing a fetch would tell us that we don't already know.
 */
let subscribed = false;

/**
 * Raise a notification for a message that just arrived over the socket.
 *
 * The server pushes to this device too, but only usefully when the app isn't
 * running: a push to a foregrounded app is slower than the socket that already
 * delivered the row, and on some devices arrives not at all. So the socket
 * notifies for itself and the two paths de-duplicate on the message id (see
 * lib/notifications.ts).
 *
 * Only INSERTs reach here, so an edited or deleted message never rings twice,
 * and rows that come down in a pull — the whole history, on a fresh join —
 * never ring at all.
 */
function announceMessage(row: SharedMessage): void {
  const me = getCurrentUserId();
  if (!me || row.sender_id === me) return; // your own message, echoed back

  // It is on this device now, whether or not anyone looks at it — which is
  // precisely what the sender's second tick means.
  markBooksDelivered(me);

  // A message the sender took back arrives as an UPDATE, not an insert, so it
  // never reaches here; this is only ever something new to be told about.
  const sender = getSharedMemberName(row.sender_id) ?? 'New message';
  const book = getSharedBook(row.book_id)?.name?.trim();

  void presentChatMessage({
    messageId: row.id,
    bookId: row.book_id,
    title: book ? `${sender} · ${book}` : sender,
    body: row.body.trim() || 'Shared an entry',
  });
}

/** Applies one row from a change event. */
function handleChange(table: SharedTable, payload: { eventType: string; new?: any; old?: any }): void {
  if (payload.eventType === 'DELETE') {
    // A hard delete only carries the old row, and only when the table has
    // REPLICA IDENTITY FULL (the SQL sets that). Treat it as a tombstone.
    const old = payload.old;
    if (old?.id) applyRemoteRows(table, [{ ...old, deleted: true }]);
    return;
  }

  const row = payload.new;
  if (!row?.id) return;
  applyRemoteRows(table, [row]);
  // applyRemoteRows already fires the change bus, so every open screen using
  // useQuery re-renders on its own — no extra wiring per screen.

  // Applied first on purpose: by the time the banner appears the message is
  // already in the thread, so opening it from the notification shows it.
  if (table === 'shared_messages' && payload.eventType === 'INSERT' && !row.deleted) {
    announceMessage(row as SharedMessage);
  }
}

/**
 * Start listening. Safe to call repeatedly; only the first call opens a socket.
 * `onResubscribe` fires once the channel is live, and should run a pull to
 * cover the gap while it was down.
 */
export function startRealtime(onResubscribe: () => void): void {
  if (channel) return;

  const next = supabase.channel('shared-books');
  for (const table of SHARED_TABLES) {
    next.on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table },
      (payload: any) => handleChange(table, payload)
    );
  }

  // No filter is set on purpose: Realtime applies RLS per subscriber, so the
  // server only ever sends rows from books this account belongs to. Filtering
  // client-side by book id would be both redundant and easier to get wrong.
  next.subscribe((status) => {
    subscribed = status === 'SUBSCRIBED';
    if (subscribed) onResubscribe();
  });

  channel = next;
}

/** Stop listening — on sign-out, or while the app is in the background. */
export function stopRealtime(): void {
  subscribed = false;
  if (!channel) return;
  const open = channel;
  channel = null;
  supabase.removeChannel(open).catch(() => {
    // Already gone, or offline. Either way there's nothing left to close.
  });
}

/** True while a channel object exists (not necessarily connected). */
export function isRealtimeActive(): boolean {
  return channel !== null;
}

/** True while the server has confirmed the subscription and is pushing rows. */
export function isRealtimeLive(): boolean {
  return channel !== null && subscribed;
}
