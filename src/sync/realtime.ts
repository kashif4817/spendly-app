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

import { applyRemoteRows, SHARED_TABLES, type SharedTable } from '@/db';
import { supabase } from '@/lib/supabase';

let channel: RealtimeChannel | null = null;

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
    if (status === 'SUBSCRIBED') onResubscribe();
  });

  channel = next;
}

/** Stop listening — on sign-out, or while the app is in the background. */
export function stopRealtime(): void {
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
