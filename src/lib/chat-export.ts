/**
 * A conversation, as plain text you can send anywhere.
 *
 * WHY: a shared book is a record two people keep together, and sooner or
 * later one of them needs it outside the app — to settle an argument, to
 * forward to a third person, to keep after the book is gone. The app already
 * exports the ledger; the thread that explains the ledger should come too.
 *
 * VANISHING MESSAGES ARE NEVER INCLUDED. The promise is that they leave no
 * copy behind, and an export is the most durable copy there is. A thread that
 * could be exported around that promise would not be worth making.
 */

import { formatRelativeDay, formatTime } from '@/lib/date';
import { formatMoney } from '@/lib/money';

import type { SharedEntry, SharedMessage } from '@/db';

export type TranscriptOptions = {
  bookName: string;
  /** Oldest first — the order a conversation is read in. */
  messages: SharedMessage[];
  /** Who sent it: your own name, or theirs. */
  nameFor: (senderId: string) => string;
  /** The entry a message quotes, when it quotes one. */
  entryFor: (entryId: string) => SharedEntry | null;
  /** Your own id, so a quoted entry reads "You paid" the way it does on screen. */
  me: string;
};

/** Build the transcript. Returns '' when there is nothing worth sending. */
export function buildTranscript({
  bookName,
  messages,
  nameFor,
  entryFor,
  me,
}: TranscriptOptions): string {
  const lines: string[] = [];
  let day = '';

  for (const message of messages) {
    if (message.vanish_at) continue;

    const messageDay = message.created_at.slice(0, 10);
    if (messageDay !== day) {
      day = messageDay;
      // A blank line before each date, except the first, so runs of a day
      // read as blocks rather than as one wall.
      if (lines.length > 0) lines.push('');
      lines.push(`— ${formatRelativeDay(messageDay)} —`);
    }

    const who = nameFor(message.sender_id);
    const when = formatTime(message.created_at);

    if (message.deleted_at) {
      lines.push(`[${when}] ${who}: (deleted)`);
      continue;
    }

    const pieces: string[] = [];
    if (message.entry_id) {
      const entry = entryFor(message.entry_id);
      pieces.push(
        entry
          ? `(entry: ${entry.payer_id === me ? 'You' : nameFor(entry.payer_id)} paid ` +
            `${formatMoney(entry.amount)}${entry.note.trim() ? ` — ${entry.note.trim()}` : ''})`
          : '(entry: removed)'
      );
    }
    if (message.body.trim()) pieces.push(message.body.trim());
    if (pieces.length === 0) continue;

    lines.push(`[${when}] ${who}: ${pieces.join(' ')}${message.edited_at ? ' (edited)' : ''}`);
  }

  if (lines.length === 0) return '';
  return `${bookName}\n\n${lines.join('\n')}`;
}
