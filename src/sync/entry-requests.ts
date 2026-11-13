/**
 * Approval requests for locked shared entries.
 *
 * Past its first 24 hours an entry can only be changed or deleted with the
 * other member's say-so (supabase/entry-safety.sql). A request carries the
 * exact change; approving applies that and nothing else.
 *
 * All three calls go to the server first and need a connection, the way
 * creating or joining a book does. A request is a question to another person:
 * queueing one offline would let you believe you had asked when you hadn't.
 */

import {
  applyRemoteRows,
  getBookMembers,
  getCurrentUserId,
  getSharedMemberName,
  notifyDbChanged,
  type SharedEntry,
  type SharedEntryRequest,
} from '@/db';
import { notify } from '@/lib/confirm';
import { entryLabel } from '@/lib/entry-lock';
import { supabase } from '@/lib/supabase';
import { pullShared } from '@/sync/shared';

/** Raised with a message the UI can show as-is. */
export class EntryRequestError extends Error {}

/** The server raises bare codes; the wording lives here. */
function describe(error: { message?: string } | null): string {
  const raw = error?.message ?? '';
  if (raw.includes('REQUEST_PENDING')) return 'There’s already a request waiting for this entry.';
  if (raw.includes('NOBODY_TO_ASK')) return 'Nobody else is in this book to approve it.';
  if (raw.includes('NO_CHANGE')) return 'Nothing has changed.';
  if (raw.includes('NOT_AUTHOR')) return 'Only the person who added an entry can change it.';
  if (raw.includes('ENTRY_NOT_FOUND')) return 'This entry no longer exists.';
  if (raw.includes('REQUEST_NOT_FOUND')) return 'This request no longer exists.';
  if (raw.includes('OWN_REQUEST')) return 'You can’t approve your own request.';
  if (raw.includes('NOT_REQUESTER')) return 'Only the person who asked can cancel this.';
  if (raw.includes('BAD_AMOUNT')) return 'Enter an amount above zero.';
  if (raw.includes('BAD_DAY')) return 'That date isn’t valid.';
  if (raw.includes('BAD_NOTE')) return 'That note is too long.';
  if (raw.includes('BAD_PAYER')) return 'Whoever paid has to be in this book.';
  if (raw.includes('NOT_SIGNED_IN')) return 'You need to be signed in to do that.';
  if (raw.includes('Could not find the function') || raw.includes('schema cache')) {
    return 'Approvals aren’t set up on the server yet. Run supabase/entry-safety.sql.';
  }
  if (/network|fetch|timed? ?out/i.test(raw)) return 'You need a connection to do this.';
  return raw || 'Something went wrong. Please try again.';
}

/**
 * True for a refusal the server actually gave (a raised exception carries a
 * code), as opposed to a request that never got there. Only the first kind is
 * an answer; the second means "try again later".
 */
function isServerAnswer(error: { code?: string } | null): boolean {
  return !!error?.code;
}

/** Store a request the server just handed back. */
function adopt(row: unknown): SharedEntryRequest {
  const request = row as SharedEntryRequest;
  applyRemoteRows('shared_entry_requests', [request as any]);
  return request;
}

export type RequestedChange =
  | { kind: 'edit'; payerId: string; amount: number; note: string; day: string }
  | { kind: 'delete' };

/** Ask the other member to approve a change to (or the deletion of) your entry. */
export async function requestEntryChange(
  entryId: string,
  change: RequestedChange
): Promise<SharedEntryRequest> {
  const { data, error } = await supabase.rpc('request_entry_change', {
    p_entry_id: entryId,
    p_kind: change.kind,
    ...(change.kind === 'edit'
      ? {
          p_amount: change.amount,
          p_note: change.note,
          p_day: change.day,
          p_payer_id: change.payerId,
        }
      : {}),
  });
  if (error || !data) throw new EntryRequestError(describe(error));
  return adopt(data);
}

/**
 * Approve or turn down the other member's request. Resolves with the request
 * as it now stands — 'expired' or 'cancelled' when it was too late to answer,
 * in which case nothing was applied.
 */
export async function respondToEntryRequest(
  requestId: string,
  approve: boolean,
  reason = ''
): Promise<SharedEntryRequest> {
  const { data, error } = await supabase.rpc('respond_entry_request', {
    p_request_id: requestId,
    p_approve: approve,
    p_reason: reason,
  });
  if (error || !data) throw new EntryRequestError(describe(error));
  const request = adopt(data);
  // An approval changed the entry and wrote a log line; bring both down now
  // rather than on the next cycle, so the book is right when the sheet closes.
  if (request.status === 'approved') void pullShared();
  return request;
}

/** Withdraw your own request while it is still waiting. */
export async function cancelEntryRequest(requestId: string): Promise<SharedEntryRequest> {
  const { data, error } = await supabase.rpc('cancel_entry_request', { p_request_id: requestId });
  if (error || !data) throw new EntryRequestError(describe(error));
  return adopt(data);
}

/** Put the server's copy of an entry back on this phone, over a refused local change. */
async function restoreServerEntry(entryId: string): Promise<SharedEntry | null> {
  const { data, error } = await supabase
    .from('shared_entries')
    .select('*')
    .eq('id', entryId)
    .maybeSingle();
  if (error || !data) return null;
  applyRemoteRows('shared_entries', [data as any], { force: true });
  notifyDbChanged();
  return data.deleted ? null : (data as SharedEntry);
}

function otherMemberName(bookId: string): string {
  const me = getCurrentUserId();
  const other = getBookMembers(bookId).find((m) => m.user_id !== me);
  return (other && getSharedMemberName(other.user_id)) || 'the other person';
}

/**
 * An upload of yours the server refused as ENTRY_LOCKED — made inside the 24
 * hours, but it only reached the server after them (offline, or a phone clock
 * running fast). Rather than leave it stuck in the outbox, refused for ever,
 * send it as a request for the very same change, then put the server's copy
 * back until that request is answered.
 *
 * Returns true once the server has answered (request made, or refused for a
 * reason no retry will fix): the outbox row is then done with. False when the
 * server couldn't be reached, so the row stays queued and this runs again.
 *
 * `local` is the row as this phone has it, or null for a delete.
 */
export async function sendLockedUploadAsRequest(
  entryId: string,
  local: Record<string, any> | null
): Promise<{ handled: boolean; restore: () => Promise<void> }> {
  const change: RequestedChange = local
    ? {
        kind: 'edit',
        payerId: String(local.payer_id),
        amount: Number(local.amount),
        note: String(local.note ?? ''),
        day: String(local.day),
      }
    : { kind: 'delete' };

  const { data, error } = await supabase.rpc('request_entry_change', {
    p_entry_id: entryId,
    p_kind: change.kind,
    ...(change.kind === 'edit'
      ? { p_amount: change.amount, p_note: change.note, p_day: change.day, p_payer_id: change.payerId }
      : {}),
  });
  if (error && !isServerAnswer(error)) return { handled: false, restore: async () => {} };

  const what = change.kind === 'delete' ? 'delete' : 'change';
  return {
    handled: true,
    // Run by the engine AFTER it has dropped the outbox row — until then the
    // queued change would shield the local copy from the server's.
    restore: async () => {
      if (data) adopt(data);
      const entry = await restoreServerEntry(entryId);
      const label = entry ? `“${entryLabel(entry)}”` : 'an entry';
      if (data) {
        const request = data as SharedEntryRequest;
        notify(
          'Sent for approval',
          `Your ${what} to ${label} reached the server more than 24 hours after the entry was added, so it was sent to ${otherMemberName(request.book_id)} to approve.`
        );
      } else {
        notify(
          `Your ${what} wasn’t saved`,
          `${label === 'an entry' ? 'The entry' : label} is more than 24 hours old, so changes need approval. ${describe(error)}`
        );
      }
    },
  };
}
