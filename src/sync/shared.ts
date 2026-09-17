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
  applyRemoteRows,
  cacheSharedProfile,
  deleteSharedBookLocally,
  renameSharedBookLocally,
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
import { PULL_BATCH_SIZE } from '@/sync/config';

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

/** True when Supabase says the table isn't there — see sync/engine.ts. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('does not exist') || message.includes('schema cache');
}

/**
 * Fetch everything in your books that changed since the shared cursor.
 *
 * Note the absence of any `.eq('user_id', …)`: RLS decides what you may see, so
 * asking for "all shared entries" returns exactly the ones from your books.
 */
export async function pullShared(): Promise<boolean> {
  const cursor = getSharedCursor();
  let maxUpdatedAt = cursor;

  try {
    for (const table of SHARED_TABLES) {
      let pageCursor = cursor;

      for (;;) {
        let query = supabase
          .from(table)
          .select('*')
          .order('updated_at', { ascending: true })
          .limit(PULL_BATCH_SIZE);
        if (pageCursor) query = query.gt('updated_at', pageCursor);

        const { data, error } = await query;
        if (error) {
          // Shared books not installed on the server yet — skip the whole
          // feature rather than failing the personal sync alongside it.
          if (isMissingTable(error)) break;
          return false;
        }
        if (!data || data.length === 0) break;

        applyRemoteRows(table, data as any);

        pageCursor = data[data.length - 1].updated_at as string;
        if (!maxUpdatedAt || new Date(pageCursor).getTime() > new Date(maxUpdatedAt).getTime()) {
          maxUpdatedAt = pageCursor;
        }
        if (data.length < PULL_BATCH_SIZE) break;
      }
    }

    await cacheMemberProfiles();
  } catch {
    return false; // offline — try again on the next cycle
  }

  if (maxUpdatedAt && maxUpdatedAt !== cursor) setSharedCursor(maxUpdatedAt);
  return true;
}
