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
  applyRemoteRows,
  columnsFor,
  getOutbox,
  getRowForUpload,
  getSyncCursor,
  removeOutboxEntry,
  setSyncCursor,
  SYNC_TABLES,
  type SyncTable,
} from '@/db';
import { supabase } from '@/lib/supabase';
import { isSyncConfigured, PULL_BATCH_SIZE } from '@/sync/config';

/** Build the row object to upload, forcing the owner and a live (non-deleted) state. */
function buildUploadRow(table: SyncTable, local: Record<string, any>, userId: string) {
  const row: Record<string, any> = {};
  for (const col of columnsFor(table)) row[col] = local[col];
  row.user_id = userId;
  row.deleted = false;
  return row;
}

/** Send queued local changes to Supabase. Stops (returns false) on the first error. */
async function push(userId: string): Promise<boolean> {
  for (const entry of getOutbox()) {
    const table = entry.table_name;

    if (entry.op === 'delete') {
      // Soft-delete on the server so other devices see the tombstone on pull.
      // A row that was never uploaded simply matches nothing — harmless.
      const { error } = await supabase
        .from(table)
        .update({ deleted: true, updated_at: new Date().toISOString() })
        .eq('id', entry.row_id)
        .eq('user_id', userId);
      if (error) return false;
    } else {
      const local = getRowForUpload(table, entry.row_id);
      if (!local) {
        // Row is gone locally; nothing to upload.
        removeOutboxEntry(entry.seq);
        continue;
      }
      const { error } = await supabase.from(table).upsert(buildUploadRow(table, local, userId));
      if (error) return false;
    }

    removeOutboxEntry(entry.seq);
  }
  return true;
}

/** Fetch and apply everything changed since the cursor. Advances the cursor on success. */
async function pull(userId: string): Promise<boolean> {
  const cursor = getSyncCursor();
  let maxUpdatedAt = cursor;

  for (const table of SYNC_TABLES) {
    let pageCursor = cursor;

    // Page through the table in case a first sync returns more than one batch.
    for (;;) {
      let query = supabase
        .from(table)
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: true })
        .limit(PULL_BATCH_SIZE);
      if (pageCursor) query = query.gt('updated_at', pageCursor);

      const { data, error } = await query;
      if (error) return false;
      if (!data || data.length === 0) break;

      applyRemoteRows(table, data as any);

      pageCursor = data[data.length - 1].updated_at as string;
      if (!maxUpdatedAt || new Date(pageCursor).getTime() > new Date(maxUpdatedAt).getTime()) {
        maxUpdatedAt = pageCursor;
      }
      if (data.length < PULL_BATCH_SIZE) break;
    }
  }

  if (maxUpdatedAt && maxUpdatedAt !== cursor) setSyncCursor(maxUpdatedAt);
  return true;
}

/** Run one full push-then-pull cycle for the signed-in user. */
export async function runSync(userId: string): Promise<boolean> {
  if (!isSyncConfigured()) return false;
  try {
    if (!(await push(userId))) return false;
    return await pull(userId);
  } catch {
    return false; // network blip / offline — try again later
  }
}
