/**
 * The pull half of a sync cycle, shared by both lanes.
 *
 * Both the personal lane (sync/engine.ts) and the shared lane (sync/shared.ts)
 * do the same thing to every table they own: ask for rows newer than a cursor,
 * page through them, apply them locally, and report the newest timestamp seen.
 * Only the scoping differs — personal tables filter by owner, shared ones let
 * Row Level Security decide.
 *
 * Tables are pulled CONCURRENTLY by the callers. They were pulled one after
 * another before, which on a phone meant ten round trips end to end just to
 * learn that nothing had changed; opening a shared book waited out every one
 * of them. Nothing here depends on another table's result, and the local
 * writes are synchronous, so there is no ordering to preserve.
 */

import { applyRemoteRows, type AnyTable } from '@/db';
import { supabase } from '@/lib/supabase';
import { PULL_BATCH_SIZE } from '@/sync/config';

/**
 * True when Supabase says the table itself isn't there.
 *
 * A table added by an app update only exists in the project once its SQL has
 * been run (see supabase/*.sql). Until then we skip that table rather than fail
 * the cycle — otherwise one missing table would stop *all* data syncing, and
 * an over-the-air update could reach a device before the backend is ready.
 * Queued changes stay in the outbox and go up once the table appears.
 */
export function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 = undefined_table (Postgres); PGRST205 = unknown table (PostgREST cache).
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('does not exist') || message.includes('schema cache');
}

/**
 * Fetch and apply one table's changes since `cursor`.
 *
 * Returns the newest `updated_at` it applied (null when nothing changed), or
 * `false` when the request failed for a reason worth retrying — a missing
 * table is not one of those, and reads as "nothing changed".
 */
export async function pullTable(
  table: AnyTable,
  cursor: string | null,
  /** Set on personal tables only; shared tables are scoped by RLS instead. */
  userId?: string
): Promise<string | null | false> {
  let pageCursor = cursor;
  let newest: string | null = null;

  for (;;) {
    let query = supabase
      .from(table)
      .select('*')
      .order('updated_at', { ascending: true })
      .limit(PULL_BATCH_SIZE);
    if (userId) query = query.eq('user_id', userId);
    if (pageCursor) query = query.gt('updated_at', pageCursor);

    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) return newest; // skip this table, keep the rest
      return false;
    }
    if (!data || data.length === 0) return newest;

    applyRemoteRows(table, data as any);

    pageCursor = data[data.length - 1].updated_at as string;
    newest = pageCursor;
    if (data.length < PULL_BATCH_SIZE) return newest;
  }
}

/**
 * Collect the results of a concurrent pull into one cursor.
 *
 * Returns `false` if any table failed, so the caller leaves the cursor where
 * it was and tries the whole set again. Rows already applied are harmless —
 * the next pull simply re-applies them, and last-write-wins makes that a
 * no-op.
 */
export function foldCursors(
  base: string | null,
  results: PromiseSettledResult<string | null | false>[]
): string | null | false {
  let max = base;
  for (const result of results) {
    if (result.status === 'rejected' || result.value === false) return false;
    const value = result.value;
    if (!value) continue;
    if (!max || new Date(value).getTime() > new Date(max).getTime()) max = value;
  }
  return max;
}
