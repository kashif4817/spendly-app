/**
 * Shared books: the second sync lane.
 *
 * The personal lane (sync/engine.ts) scopes everything by `user_id = auth.uid()`.
 * Shared rows have no single owner — they belong to whoever is a member — so
 * they can't ride along. Instead:
 *
 *   • Pull asks for the shared tables with NO owner filter at all. Row Level
 *     Security already limits the result to books you belong to, which is both
 *     simpler and safer than trusting the client to filter correctly.
 *   • Push only ever sends `shared_entries`. Creating a book, joining one and
 *     rotating a code are server-side functions, so there's nothing else a
 *     client needs to upload.
 *
 * Creating and joining need a connection (a code has to come from the server).
 * Everything after that — adding entries, editing, deleting — works offline and
 * uploads itself on reconnect, exactly like the personal ledger.
 */

import * as Crypto from 'expo-crypto';

import {
  cacheSharedProfile,
  getCurrentUserId,
  markBooksDelivered,
  deleteSharedBookLocally,
  renameSharedBookLocally,
  setBookExpiryLocally,
  setBookPinnedLocally,
  setBookVanishLocally,
  getSharedCursor,
  getUncachedMemberIds,
  notifyDbChanged,
  SHARED_TABLES,
  setSharedCursor,
  upsertSharedBook,
  upsertSharedMember,
  type SharedBook,
} from '@/db';
import { supabase } from '@/lib/supabase';
import { foldCursors, pullTable } from '@/sync/pull';

/** Raised with a message the UI can show as-is. */
export class SharedBookError extends Error {}

/**
 * Turn a Postgres `raise exception` into something a person can read. The
 * server raises bare codes (INVALID_CODE, BOOK_FULL, …) precisely so the
 * wording lives here rather than in SQL.
 */
function describe(error: { message?: string } | null): string {
  const raw = error?.message ?? '';
  if (raw.includes('INVALID_CODE')) return 'That code doesn’t match any book. Check it and try again.';
  if (raw.includes('CODE_EXPIRED')) return 'That code has expired. Ask your friend for a fresh one.';
  if (raw.includes('BOOK_FULL')) return 'That book already has two people in it.';
  if (raw.includes('NOT_OWNER')) return 'Only the person who created the book can change the code.';
  if (raw.includes('NOT_SIGNED_IN')) return 'You need to be signed in to do that.';
  if (raw.includes('expire_after') || raw.includes('vanish_state') || raw.includes('pinned_message')) {
    return 'This needs the latest chat tables. Run supabase/shared-chat.sql in Supabase.';
  }
  if (raw.includes('Could not find the function') || raw.includes('schema cache')) {
    return 'Shared books aren’t set up on the server yet. Run supabase/shared-books.sql.';
  }
  return raw || 'Something went wrong. Please try again.';
}

/** Store a book the server just handed us, plus our own membership in it. */
function adoptBook(book: SharedBook, userId: string): void {
  upsertSharedBook(book);
  upsertSharedMember({
    id: `${book.id}:${userId}`,
    book_id: book.id,
    user_id: userId,
    joined_at: book.created_at,
  });
}

/** Create a book and become its owner. Needs a connection. */
export async function createSharedBook(name: string, userId: string): Promise<SharedBook> {
  const id = Crypto.randomUUID();
  const { data, error } = await supabase.rpc('create_book', { p_id: id, p_name: name });
  if (error || !data) throw new SharedBookError(describe(error));

  const book = data as SharedBook;
  adoptBook(book, userId);
  return book;
}

/** Redeem a join code. Needs a connection. */
export async function joinSharedBook(code: string, userId: string): Promise<SharedBook> {
  const { data, error } = await supabase.rpc('join_book', { p_code: code.trim().toUpperCase() });
  if (error || !data) throw new SharedBookError(describe(error));

  const book = data as SharedBook;
  adoptBook(book, userId);
  // Pull straight away so the book opens with its history already in place
  // rather than filling in a second later.
  await pullShared();
  return book;
}

/**
 * Retitle a book. Either member may do it — the name is a shared label, and the
 * server only grants UPDATE on that one column, so nothing else is reachable.
 *
 * The server goes first on purpose. Renaming locally first would leave a name
 * that no pull can correct if the write fails: the local row's `updated_at`
 * would be newer than the server's, so last-write-wins would keep the wrong
 * name forever.
 */
export async function renameSharedBook(bookId: string, name: string): Promise<string> {
  const clean = name.trim();
  if (!clean) throw new SharedBookError('Enter a name.');

  const { error } = await supabase.from('shared_books').update({ name: clean }).eq('id', bookId);
  if (error) throw new SharedBookError(describe(error));

  renameSharedBookLocally(bookId, clean);
  return clean;
}

/**
 * Set how long messages in a book live, in seconds — 0 turns it off.
 *
 * Either member may set it, and the server only grants UPDATE on this column
 * and `name`, so nothing else on the book is reachable from here.
 *
 * The server goes first for the same reason a rename does: writing locally
 * first would leave an `updated_at` newer than the server's if the write
 * failed, and last-write-wins would then keep a setting the other person
 * never agreed to — which, for a promise about deleting messages, is the
 * worst possible thing to get stuck on.
 */
export async function setSharedBookExpiry(bookId: string, seconds: number): Promise<void> {
  const { error } = await supabase
    .from('shared_books')
    .update({ expire_after: seconds })
    .eq('id', bookId);
  if (error) throw new SharedBookError(describe(error));

  setBookExpiryLocally(bookId, seconds);
}

/**
 * Hold one message at the top of a book's thread, or clear the pin with null.
 *
 * On the book rather than the message so that either member can pin what the
 * OTHER one said — writing to their message row is exactly what the server
 * refuses. Server first, for the same reason a rename is.
 */
export async function setSharedBookPin(bookId: string, messageId: string | null): Promise<void> {
  const { error } = await supabase
    .from('shared_books')
    .update({ pinned_message: messageId })
    .eq('id', bookId);
  if (error) throw new SharedBookError(describe(error));

  setBookPinnedLocally(bookId, messageId);
}

/**
 * Move a book's vanishing session along: '', 'ask:<uuid>' or 'on'.
 *
 * The state machine lives in the screen; this is only the write. Server first
 * again, and here it matters most of all — a local 'on' that never reached
 * the server would have one person believing the conversation vanishes while
 * the other's device keeps every word of it.
 */
export async function setSharedBookVanish(bookId: string, state: string): Promise<void> {
  const { error } = await supabase
    .from('shared_books')
    .update({ vanish_state: state })
    .eq('id', bookId);
  if (error) throw new SharedBookError(describe(error));

  setBookVanishLocally(bookId, state);
}

/** Mint a new code, invalidating the old one. Owner only. */
export async function rotateJoinCode(bookId: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_join_code', { p_book_id: bookId });
  if (error || !data) throw new SharedBookError(describe(error));

  await pullShared(); // bring the new code and its expiry into the local copy
  return data as string;
}

/**
 * Leave a book: soft-delete your membership on the server, then drop the local
 * copy. The other member keeps the book and its full history.
 */
export async function leaveSharedBook(bookId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('shared_book_members')
    .update({ deleted: true, updated_at: new Date().toISOString() })
    .eq('book_id', bookId)
    .eq('user_id', userId);
  if (error) throw new SharedBookError(describe(error));

  deleteSharedBookLocally(bookId);
}

/**
 * Fetch names for members we've never seen before.
 *
 * `profiles` is own-row only by default; supabase/shared-books.sql adds a
 * policy letting you read the profile of anyone you share a book with. Without
 * this every entry your friend adds would be labelled with a bare uuid.
 */
async function cacheMemberProfiles(): Promise<void> {
  const missing = getUncachedMemberIds();
  if (missing.length === 0) return;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email')
    .in('id', missing);
  if (error || !data) return; // best-effort — a uuid is a poor label, not a failure

  for (const row of data) {
    cacheSharedProfile(row.id as string, (row.name as string) ?? null, (row.email as string) ?? null);
  }
  if (data.length > 0) notifyDbChanged();
}

/**
 * Fetch everything in your books that changed since the shared cursor.
 *
 * Note the absence of any `.eq('user_id', …)`: RLS decides what you may see, so
 * asking for "all shared entries" returns exactly the ones from your books.
 * The three tables go out together — books, memberships and entries have no
 * bearing on each other's requests, and this is the pull the book screen
 * waits on, so its latency is the one the user actually feels.
 */
export async function pullShared(): Promise<boolean> {
  const cursor = getSharedCursor();

  try {
    const results = await Promise.allSettled(
      SHARED_TABLES.map((table) => pullTable(table, cursor))
    );

    const newest = foldCursors(cursor, results);
    if (newest === false) return false;

    // Only worth a request when a member turned up that we have no name for.
    await cacheMemberProfiles();

    // Whatever that pull brought down is now on this device, which is exactly
    // what the second tick on the other person's screen claims. Recorded here
    // rather than in the chat screen because delivery does not wait for the
    // thread to be opened — that is what the THIRD tick is for.
    const me = getCurrentUserId();
    if (me) markBooksDelivered(me);

    if (newest && newest !== cursor) setSharedCursor(newest);
    return true;
  } catch {
    return false; // offline — try again on the next cycle
  }
}

/**
 * Carry one day's hand-arranged order up to the server.
 *
 * Reordering moves rows BOTH members wrote, and `shared_entries` lets only an
 * author write their own row — the rule that stops either side quietly
 * rewriting the record. The order is not the record, though: it is a shared
 * view of it, so it travels by `reorder_entries()`, a definer function either
 * member may call that touches `sort` and nothing else.
 *
 * Best-effort on purpose, and not queued. The order is already applied on this
 * phone, your own rows are in the outbox anyway (see `reorderSharedDay`), and
 * the worst a lost call can do is leave the other phone showing its own order
 * for the rows you don't own. That is a far smaller problem than a reorder
 * sitting in a queue, retrying for ever, in front of real money.
 */
export async function pushEntryOrder(bookId: string, ids: string[]): Promise<void> {
  if (!bookId || ids.length === 0) return;
  try {
    await supabase.rpc('reorder_entries', { p_book_id: bookId, p_ids: ids });
  } catch {
    // Offline, or supabase/entry-order.sql hasn't been run yet. Either way the
    // local order stands and nothing else is affected.
  }
}
