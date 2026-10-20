/**
 * The sync engine: moves data between the local SQLite database and Supabase.
 *
 * A cycle is push-then-pull:
 *   1. Push  — drain the local outbox (offline edits) up to Supabase.
 *   2. Pull  — fetch every row changed since the last cursor and apply it,
 *              resolving conflicts by last-write-wins.
 *
 * Everything is best-effort: the first network error aborts the cycle and it's
 * retried later (on app foreground, after the next edit, or on a timer). Nothing
 * here throws — callers just get `true` (synced) or `false` (offline/failed).
 */

import {
  columnsFor,
  getOutbox,
  getRowForUpload,
  getSyncCursor,
  isSharedTable,
  removeOutboxEntry,
  setSyncCursor,
  SHARED_TABLES,
  SYNC_TABLES,
  type AnyTable,
} from '@/db';
import { supabase } from '@/lib/supabase';
import { isSyncConfigured } from '@/sync/config';
import { foldCursors, isMissingTable, pullTable } from '@/sync/pull';
import { pullShared } from '@/sync/shared';

/**
 * The last row the server refused, kept so the UI can actually say what went
 * wrong. Everything here is best-effort and silent by design, which is fine
 * until something is permanently broken — then silence is the whole problem.
 */
export type SyncFailure = {
  table: string;
  rowId: string;
  op: 'upsert' | 'delete';
  code: string;
  message: string;
  at: string;
};

let lastFailure: SyncFailure | null = null;

export function getLastSyncFailure(): SyncFailure | null {
  return lastFailure;
}

export function clearLastSyncFailure(): void {
  lastFailure = null;
}

function recordFailure(
  table: string,
  rowId: string,
  op: 'upsert' | 'delete',
  error: { code?: string; message?: string; details?: string }
): void {
  lastFailure = {
    table,
    rowId,
    op,
    code: error.code ?? '',
    message: [error.message, error.details].filter(Boolean).join(' — ') || 'Unknown error',
    at: new Date().toISOString(),
  };
}

/** Build the row object to upload, forcing the owner and a live (non-deleted) state. */
function buildUploadRow(table: AnyTable, local: Record<string, any>, userId: string) {
  const row: Record<string, any> = {};
  for (const col of columnsFor(table)) row[col] = local[col];
  // Shared rows belong to a book, not to one account, so they carry no
  // `user_id`; the server ties them to you through `author_id` instead.
  if (!isSharedTable(table)) row.user_id = userId;
  row.deleted = false;
  return row;
}

/**
 * The column naming who may change a row. On personal tables that's the owner;
 * on shared tables only the author can touch their own entry, which is what
 * stops either member rewriting the other's record.
 */
function ownerColumn(table: AnyTable): string {
  return isSharedTable(table) ? 'author_id' : 'user_id';
}

/** Send queued local changes to Supabase. Stops (returns false) on the first error. */
/**
 * Send queued local changes to Supabase.
 *
 * A row the server REFUSES (a policy rejection, a constraint, a bad value) is
 * recorded and stepped over rather than aborting the run. It used to return
 * false here, which meant one permanently-unacceptable row stopped the whole
 * queue — and, because push runs before pull, stopped every other table from
 * syncing too, for good. The row stays queued, so it still goes up the moment
 * whatever the server objected to is fixed.
 *
 * A dropped connection is different: that throws rather than returning an
 * error, and runSync's catch treats it as "offline, try again later".
 */
async function push(userId: string, only?: readonly string[]): Promise<boolean> {
  let allSent = true;

  for (const entry of getOutbox()) {
    const table = entry.table_name;
    // The shared lane drains only shared rows: a book shouldn't wait on a
    // queued expense, and an expense shouldn't wait on a book.
    if (only && !only.includes(table)) continue;

    if (entry.op === 'delete') {
      // Soft-delete on the server so other devices see the tombstone on pull.
      // A row that was never uploaded simply matches nothing — harmless.
      const { error } = await supabase
        .from(table)
        .update({ deleted: true, updated_at: new Date().toISOString() })
        .eq('id', entry.row_id)
        .eq(ownerColumn(table), userId);
      if (error) {
        if (!isMissingTable(error)) recordFailure(table, entry.row_id, 'delete', error);
        allSent = false;
        continue; // leave it queued, and keep draining the rest
      }
    } else {
      const local = getRowForUpload(table, entry.row_id);
      if (!local) {
        // Row is gone locally; nothing to upload.
        removeOutboxEntry(entry.seq);
        continue;
      }
      const { error } = await supabase.from(table).upsert(buildUploadRow(table, local, userId));
      if (error) {
        if (!isMissingTable(error)) recordFailure(table, entry.row_id, 'upsert', error);
        allSent = false;
        continue; // leave it queued, and keep draining the rest
      }
    }

    removeOutboxEntry(entry.seq);
  }

  return allSent;
}

/**
 * Fetch and apply everything changed since the cursor. Advances the cursor on
 * success.
 *
 * The seven tables are asked for at the same time rather than one after the
 * other. They don't depend on each other, so running them in series only ever
 * added six round trips of latency to a cycle that usually finds nothing to
 * do at all.
 */
async function pull(userId: string): Promise<boolean> {
  const cursor = getSyncCursor();
  const results = await Promise.allSettled(
    SYNC_TABLES.map((table) => pullTable(table, cursor, userId))
  );

  const newest = foldCursors(cursor, results);
  if (newest === false) return false;
  if (newest && newest !== cursor) setSyncCursor(newest);
  return true;
}

/**
 * Run one full cycle for the signed-in user: push, pull the personal tables,
 * then pull the shared ones.
 *
 * The shared lane runs last and its result is folded in, so a project without
 * shared-books.sql installed still syncs everything else normally.
 */
export async function runSync(userId: string): Promise<boolean> {
  if (!isSyncConfigured()) return false;
  try {
    // Note push's result does NOT short-circuit the pulls. A rejected row is a
    // problem with that row, not with the connection, and blocking reads on it
    // is what made a single bad row look like the app being permanently offline.
    const pushed = await push(userId);
    // The two lanes are independent: the personal tables are scoped by owner,
    // the shared ones by membership. Nothing in one waits on the other.
    const [personal, shared] = await Promise.all([pull(userId), pullShared()]);
    if (!personal || !shared) return false;
    return pushed;
  } catch {
    return false; // network blip / offline — try again later
  }
}

/**
 * Run one cycle for the shared books ONLY — their outbox rows up, their three
 * tables down.
 *
 * Opening a shared book used to run the full cycle above, which meant waiting
 * on categories, transactions, budgets and the rest before the balance could
 * be trusted. None of that has any bearing on what two people owe each other,
 * so the book screen asks for this instead: the same guarantees over a third
 * of the requests.
 */
export async function runSharedSync(userId: string): Promise<boolean> {
  if (!isSyncConfigured()) return false;
  try {
    const pushed = await push(userId, SHARED_TABLES);
    if (!(await pullShared())) return false;
    return pushed;
  } catch {
    return false; // network blip / offline — try again later
  }
}
