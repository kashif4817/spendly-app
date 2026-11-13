import { confirm, notify } from '@/lib/confirm';
import { formatMoney } from '@/lib/money';
import { SharedBookError, sendBalanceReminder } from '@/sync/shared';

/**
 * "Send a balance reminder" on a shared book: ask once, then ring the other
 * member's phone. A notification only — nothing is written to the chat.
 *
 * Asked first because it lands on someone else's phone and can't be taken
 * back. `balance` is this phone's figure (positive when you're owed), used
 * only for the question; the notification carries the server's.
 */
export function remindAboutBook({
  bookId,
  theirName,
  balance,
}: {
  bookId: string;
  /** null when nobody has joined yet. */
  theirName: string | null;
  balance: number;
}): void {
  const amount = Math.abs(balance);
  if (amount < 0.005) {
    notify('Nothing outstanding', 'This book is already settled up.');
    return;
  }
  if (!theirName) {
    notify('Nobody to remind', 'Nobody else has joined this book yet.');
    return;
  }

  confirm({
    title: `Remind ${theirName}?`,
    message:
      balance > 0
        ? `${theirName} will get a notification that they owe you ${formatMoney(amount)}.`
        : `${theirName} will get a notification that you owe them ${formatMoney(amount)}.`,
    confirmLabel: 'Send reminder',
    onConfirm: () => {
      sendBalanceReminder(bookId)
        // Not "they've been notified": a phone that muted the book or switched
        // reminders off is skipped by the server, and that is theirs to know.
        .then(() => notify('Reminder sent'))
        .catch((e) =>
          notify(
            'Couldn’t send the reminder',
            e instanceof SharedBookError ? e.message : 'You need a connection to do this.'
          )
        );
    },
  });
}
