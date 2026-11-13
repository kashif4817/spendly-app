/**
 * The 24-hour rule for shared-book entries, as the app sees it.
 *
 * For 24 hours after the SERVER receives an entry, its author may change or
 * delete it freely. After that the server refuses (supabase/entry-safety.sql)
 * and the change has to go to the other member as a request. The clock is the
 * server's `posted_at`, never the phone's: a phone can be set to any time.
 *
 * Everything here is a mirror of the server's rule, so the app offers
 * "Request change" instead of a Save that would only bounce. If the two ever
 * disagree near the boundary, the server wins — an edit refused as locked is
 * turned into a request by the sync engine (sync/entry-requests.ts).
 */

import type { SharedEntry, SharedEntryLog, SharedEntryRequest } from '@/db';
import { formatShortDate } from '@/lib/date';
import { formatMoney } from '@/lib/money';

export const FREE_EDIT_HOURS = 24;
const FREE_EDIT_MS = FREE_EDIT_HOURS * 60 * 60 * 1000;

/**
 * When an entry's free window closes, or null while it has none yet — not
 * uploaded, or on a project that hasn't run entry-safety.sql, where nothing
 * is locked at all.
 */
export function lockTimeOf(entry: Pick<SharedEntry, 'posted_at'>): number | null {
  if (!entry.posted_at) return null;
  const posted = Date.parse(entry.posted_at);
  return Number.isNaN(posted) ? null : posted + FREE_EDIT_MS;
}

export function isEntryLocked(entry: Pick<SharedEntry, 'posted_at'>, now = Date.now()): boolean {
  const at = lockTimeOf(entry);
  return at !== null && now >= at;
}

/** "in 5 hours" / "in 40 minutes" — how long the free window has left. */
export function freeTimeLeft(entry: Pick<SharedEntry, 'posted_at'>, now = Date.now()): string | null {
  const at = lockTimeOf(entry);
  if (at === null || now >= at) return null;
  const minutes = Math.max(1, Math.round((at - now) / 60000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/** Waiting for an answer, and not yet out of time. */
export function isRequestOpen(request: SharedEntryRequest, now = Date.now()): boolean {
  return request.status === 'pending' && Date.parse(request.expires_at) > now;
}

/** The four things that make an entry what it is. */
export type EntryValues = {
  amount: number | null;
  note: string | null;
  day: string | null;
  payer_id: string | null;
};

/** One changed field, ready to draw as "before → after". */
export type FieldChange = { label: string; before: string; after: string };

/**
 * The fields that differ between two versions of an entry. `payerLabel` turns
 * a member id into what THIS reader calls them — "You" or a name.
 */
export function changesBetween(
  before: EntryValues,
  after: EntryValues,
  payerLabel: (userId: string | null) => string
): FieldChange[] {
  const changes: FieldChange[] = [];
  if (before.amount !== after.amount) {
    changes.push({
      label: 'Amount',
      before: before.amount == null ? '—' : formatMoney(before.amount),
      after: after.amount == null ? '—' : formatMoney(after.amount),
    });
  }
  if (before.payer_id !== after.payer_id) {
    changes.push({
      label: 'Who paid',
      before: payerLabel(before.payer_id),
      after: payerLabel(after.payer_id),
    });
  }
  if (before.day !== after.day) {
    changes.push({
      label: 'Date',
      before: before.day ? formatShortDate(before.day) : '—',
      after: after.day ? formatShortDate(after.day) : '—',
    });
  }
  if ((before.note ?? '') !== (after.note ?? '')) {
    changes.push({
      label: 'Note',
      before: before.note?.trim() || 'No note',
      after: after.note?.trim() || 'No note',
    });
  }
  return changes;
}

export const requestBefore = (r: SharedEntryRequest): EntryValues => ({
  amount: r.old_amount,
  note: r.old_note,
  day: r.old_day,
  payer_id: r.old_payer_id,
});

export const requestAfter = (r: SharedEntryRequest): EntryValues => ({
  amount: r.new_amount,
  note: r.new_note,
  day: r.new_day,
  payer_id: r.new_payer_id,
});

export const logBefore = (l: SharedEntryLog): EntryValues => ({
  amount: l.old_amount,
  note: l.old_note,
  day: l.old_day,
  payer_id: l.old_payer_id,
});

export const logAfter = (l: SharedEntryLog): EntryValues => ({
  amount: l.new_amount,
  note: l.new_note,
  day: l.new_day,
  payer_id: l.new_payer_id,
});

/**
 * The entry a log line or request is about, in one line: "Lunch · 3 Aug 2026".
 * Taken from the values it HAD, so a deleted entry still has a name.
 */
export function entryLabel(values: EntryValues): string {
  const note = values.note?.trim() || 'Entry';
  return values.day ? `${note} · ${formatShortDate(values.day)}` : note;
}
