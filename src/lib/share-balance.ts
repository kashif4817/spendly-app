/**
 * Sharing a balance as a message.
 *
 * WHY NOT THE EXISTING EXPORT: lib/export.ts already turns the whole app into
 * a CSV or a PDF, and that is the right shape for records — a file you keep.
 * This is the other errand entirely: telling one person where the two of you
 * stand, in a message they read in WhatsApp without opening anything.
 *
 * TWO DECISIONS WORTH KNOWING:
 *
 * 1. "To pay" / "To receive", never "owes" — and the OTHER person is always
 *    the subject of that line. A reminder is read by the person it is about,
 *    so anything phrased as "you owe" / "you'll get" flips meaning depending
 *    on which of the two is holding the phone. Naming them and saying which
 *    way the money goes cannot be misread by either side.
 *
 * 2. It is marked up for WhatsApp (*bold*, _italic_), which is where these
 *    messages go. In an app that doesn't render that markup the asterisks show
 *    through — the message is still perfectly readable, which is the trade
 *    being made deliberately rather than by accident.
 *
 * Both kinds of ledger — a person you track on your own, and a shared book you
 * both write to — come out in the same words, so the message reads identically
 * whichever one it came from.
 */

import { Share } from 'react-native';

import {
  getBookMembers,
  getCurrentUserId,
  getPersonBalance,
  getSharedBalance,
  getSharedBook,
  getSharedMemberName,
} from '@/db';
import { formatShortDate, todayKey } from '@/lib/date';
import { formatMoney } from '@/lib/money';

/** Balances this small are rounding noise, not money owed. */
const SETTLED_EPSILON = 0.005;

type Balance = {
  /** Who it is with. Null when nobody has joined a shared book yet. */
  who: string | null;
  /** A shared book's own name, when it has one. */
  book?: string | null;
  /** Positive means they are the one to pay. */
  balance: number;
};

/**
 * The message, marked up for WhatsApp.
 *
 * Bold does the work a layout would do elsewhere: the heading, the name and
 * the figure are the three things a glance should land on, and everything else
 * is there to stop the figure being questioned — the date because a bare
 * number invites "since when?", the heading's app name because it invites
 * "says who?".
 */
function compose({ who, book, balance }: Balance): string {
  const amount = formatMoney(Math.abs(balance));

  // Whoever the message is about leads the line, so neither reader has to work
  // out which of them "you" means.
  const subject = who ? `*${who}*${book ? ` · ${book}` : ''}` : `*${book ?? 'Shared book'}*`;

  const status =
    Math.abs(balance) < SETTLED_EPSILON
      ? 'Settled — nothing pending.'
      : balance > 0
        ? `To pay: *${amount}*`
        : `To receive: *${amount}*`;

  // The app's name is in the heading, so there is no footer: a second mention
  // under a three-line message was the longest thing in it.
  return [
    '*Spendly Balance Summary*',
    '',
    subject,
    status,
    `As of ${formatShortDate(todayKey())}`,
  ].join('\n');
}

/** Hand a composed balance to the OS share sheet. */
async function send(balance: Balance): Promise<void> {
  try {
    await Share.share({ message: compose(balance) });
  } catch {
    // The sheet was dismissed — nothing to report.
  }
}

/** Share where you stand with someone from your own ledger. */
export async function sharePersonBalance(person: string): Promise<void> {
  await send({
    who: person.trim() || null,
    balance: getPersonBalance(person),
  });
}

/** Share where a shared book stands. */
export async function shareBookBalance(bookId: string): Promise<void> {
  const me = getCurrentUserId() ?? '';
  const book = getSharedBook(bookId);
  if (!book) return;

  const otherId = getBookMembers(bookId).find((m) => m.user_id !== me)?.user_id ?? null;

  await send({
    who: otherId ? getSharedMemberName(otherId) : null,
    book: book.name?.trim() || null,
    balance: getSharedBalance(bookId, me),
  });
}
