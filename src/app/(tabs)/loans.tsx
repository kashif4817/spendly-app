import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { AddButton } from '@/components/add-button';
import { UnreadBadge } from '@/components/chat';
import { GlassChip } from '@/components/glass';
import { PromptModal } from '@/components/prompt-modal';
import { KeyboardAvoider } from '@/components/keyboard-avoider';
import { SwipeRow, type SwipeAction } from '@/components/swipe-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  addLedgerEntry,
  addSharedEntry,
  combineLedgerTotals,
  createPerson,
  deleteLedgerEntry,
  deletePerson,
  deleteSharedEntry,
  getCurrentUserId,
  getLedgerTotals,
  getBookMembers,
  findPerson,
  getPeople,
  getSharedBookSummaries,
  mergePeople,
  renamePerson,
  setBookArchived,
  setBookDue,
  setPersonDue,
  setPersonPhone,
  setBookPinned,
  setPersonArchived,
  setPersonPinned,
  type PersonBalance,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { usePeopleSort } from '@/hooks/use-people-sort';
import { usePeopleView } from '@/hooks/use-people-view';
import { BalanceEye } from '@/components/balance-eye';
import { useBalanceCovered } from '@/hooks/use-balance-privacy';
import { useTheme } from '@/hooks/use-theme';
import { useLock } from '@/lock/provider';
import { addDays, daysSince, formatRelativeDay, todayKey } from '@/lib/date';
import { confirm, notify } from '@/lib/confirm';
import {
  bookScope,
  isBalanceCovered,
  personScope,
  renameBalanceScope,
  toggleBalanceCover,
  TOTAL_PAYABLE_SCOPE,
  TOTAL_RECEIVABLE_SCOPE,
} from '@/lib/balance-privacy';
import { formatMoney, HIDDEN_AMOUNT } from '@/lib/money';
import { PEOPLE_SORTS, setPeopleSort, type PeopleSort } from '@/lib/people-sort';
import { looksLikeSameName, matchesQuery } from '@/lib/people-match';
import { setPeopleView, type PeopleView } from '@/lib/people-view';
import { shareBookBalance, sharePersonBalance } from '@/lib/share-balance';
import { offerUndo } from '@/lib/undo';
import { useSync } from '@/sync/provider';
import { leaveSharedBook, renameSharedBook, SharedBookError } from '@/sync/shared';

/** Balances this small are rounding noise, not money owed. */
const SETTLED_EPSILON = 0.005;

/** Which slice of people is on screen. */
type Filter = 'all' | 'archived' | 'people' | 'shared' | 'get' | 'pay' | 'overdue' | 'settled';

// Archived sits right after All so it's in view without scrolling the row.
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'archived', label: 'Archived' },
  { key: 'people', label: 'People' },
  { key: 'shared', label: 'Shared books' },
  { key: 'get', label: 'You’ll get' },
  { key: 'pay', label: 'You’ll pay' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'settled', label: 'Settled' },
];

const VIEWS: { key: PeopleView; icon: React.ComponentProps<typeof MaterialIcons>['name']; label: string }[] = [
  { key: 'list', icon: 'view-agenda', label: 'List view' },
  { key: 'grid', icon: 'grid-view', label: 'Grid view' },
];

/** Fills the empty half of a grid row with an odd number of people. */
const GRID_SPACER = '__grid_spacer__';

/**
 * How long a balance may sit untouched before the row says so.
 *
 * A month, because that is roughly when a loan stops being "recent" in
 * someone's head and starts being a thing they have been meaning to bring up.
 * The row does not nag before then.
 */
const AGEING_DAYS = 30;

/**
 * What "expected by" can be set to, without a calendar.
 *
 * A ladder rather than a date picker, because the answer people actually have
 * is "next week" or "end of the month" — almost never a specific square on a
 * grid. Five taps' worth of options covers nearly every real promise.
 */
const DUE_CHOICES: { label: string; days: number }[] = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'In a week', days: 7 },
  { label: 'In two weeks', days: 14 },
  { label: 'In a month', days: 30 },
];

/**
 * How a due date reads on a row.
 *
 * Returns null when there is nothing to say — no date, or a settled balance,
 * where a date is a promise about nothing.
 */
function dueState(row: { dueDay: string; balance: number }): { text: string; late: boolean } | null {
  if (!row.dueDay || Math.abs(row.balance) < SETTLED_EPSILON) return null;
  const over = daysSince(row.dueDay);
  if (over > 0) return { text: over === 1 ? 'Due yesterday' : `${over}d overdue`, late: true };
  if (over === 0) return { text: 'Due today', late: true };
  const left = -over;
  return { text: left === 1 ? 'Due tomorrow' : `Due in ${left}d`, late: false };
}

/**
 * True when a name is close enough to an existing one to be worth asking about.
 *
 * `looksLikeSameName` does the deciding, and it is strict on purpose: this
 * used to test whether one name CONTAINED the other, which meant adding
 * somebody called Sir was met with "you already have Mudasir Nawaz". A
 * warning that fires on a coincidence of letters teaches people to dismiss
 * warnings. See lib/people-match.ts.
 */
function similarPerson(name: string, people: { person: string; bookId?: string }[]): string | null {
  for (const row of people) {
    if (row.bookId) continue; // a book is not a person you could have meant
    if (looksLikeSameName(name, row.person)) return row.person;
  }
  return null;
}

/**
 * A list row is either someone from your own ledger or a shared book. Shared
 * books borrow the person shape so every filter, view and total keeps working
 * on one uniform list — `bookId` is what tells them apart.
 */
type Row = PersonBalance & {
  /** Set only on a shared book; opens the shared statement instead. */
  bookId?: string;
  /** A shared book nobody has joined yet. */
  pending?: boolean;
  /** Unread chat messages in a shared book. */
  unread?: number;
  /** Stable list key — two books could carry the same display name. */
  key: string;
};

const isShared = (row: Row): boolean => !!row.bookId;

/**
 * Which balance this row is. A book is keyed by id because it can be renamed;
 * a person by the name their entries are filed under, which is their identity.
 */
const rowScope = (row: Row): string =>
  row.bookId ? bookScope(row.bookId) : personScope(row.person);

const isSettled = (person: PersonBalance) => Math.abs(person.balance) < SETTLED_EPSILON;

/** Somebody added by hand who hasn't lent or borrowed anything yet. */
const isFresh = (person: PersonBalance) => person.entries === 0;

/**
 * Deleting is permanent, so anyone carrying history — entries, an unsettled
 * balance, or both — is worth a second question before it happens.
 */
const needsSecondWarning = (person: PersonBalance) => person.entries > 0 || !isSettled(person);

/** What a delete would actually cost, in words, for the warning text. */
function deleteCost(person: PersonBalance): string {
  const count = `${person.entries} ${person.entries === 1 ? 'entry' : 'entries'}`;
  if (isSettled(person)) return count;
  const amount = formatMoney(Math.abs(person.balance));
  return person.balance > 0
    ? `${count} and the ${amount} they owe you`
    : `${count} and the ${amount} you owe them`;
}

/**
 * Order the list, with pinned people always first.
 *
 * Pinning means "keep this at the top", so it outranks every sort rather than
 * being one of them — a chosen order that moved your pins would be answering
 * a question you had already answered.
 *
 * Settled rows sink in the two money sorts. They have no balance to be
 * biggest or oldest, and leaving them interleaved buries the ones that do.
 */
function comparePeople(a: Row, b: Row, sort: PeopleSort): number {
  if (a.pinned !== b.pinned) return b.pinned - a.pinned;

  if (sort === 'amount' || sort === 'oldest' || sort === 'due') {
    const aOpen = !isSettled(a);
    const bOpen = !isSettled(b);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
  }

  if (sort === 'due') {
    // Dated first, soonest first. Anything without a date has not been
    // promised by a day, so it cannot be sooner than something that has.
    const aDue = a.dueDay || '';
    const bDue = b.dueDay || '';
    if (!!aDue !== !!bDue) return aDue ? -1 : 1;
    if (aDue && aDue !== bDue) return aDue < bDue ? -1 : 1;
  } else if (sort === 'amount') {
    const diff = Math.abs(b.balance) - Math.abs(a.balance);
    if (Math.abs(diff) > SETTLED_EPSILON) return diff;
  } else if (sort === 'oldest') {
    // An empty lastDay is someone added by hand who has never lent or
    // borrowed. They have been outstanding for no time at all, so they go
    // last rather than being treated as infinitely old.
    const aDay = a.lastDay || '9999-99-99';
    const bDay = b.lastDay || '9999-99-99';
    if (aDay !== bDay) return aDay < bDay ? -1 : 1;
  } else if (sort === 'recent') {
    if (a.lastDay !== b.lastDay) return a.lastDay < b.lastDay ? 1 : -1;
  }

  return a.person.localeCompare(b.person);
}

function matchesFilter(person: Row, filter: Filter): boolean {
  // Archived people live in their own view and nowhere else, so an archived
  // person never quietly pads the other tabs' counts.
  if (filter === 'archived') return !!person.archived;
  if (filter === 'people') return !isShared(person) && !person.archived;
  if (filter === 'shared') return isShared(person) && !person.archived;
  if (person.archived) return false;
  if (filter === 'get') return person.balance > SETTLED_EPSILON;
  if (filter === 'pay') return person.balance < -SETTLED_EPSILON;
  // Past the day it was promised back, and still outstanding. The one slice
  // of this list that is a to-do rather than a record.
  if (filter === 'overdue') {
    return !isSettled(person) && !!person.dueDay && person.dueDay < todayKey();
  }
  if (filter === 'settled') return isSettled(person);
  return true;
}

export default function PeopleScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { balancePin, hasPin } = useLock();
  // The two summaries are covered on their own, not derived from whoever
  // happens to be hidden in the list below them.
  const getCovered = useBalanceCovered(TOTAL_RECEIVABLE_SCOPE);
  const payCovered = useBalanceCovered(TOTAL_PAYABLE_SCOPE);
  const { status, refreshNow } = useSync();
  const view = usePeopleView();
  const sort = usePeopleSort();

  const me = getCurrentUserId() ?? '';
  const ownPeople = useQuery(() => getPeople());
  const books = useQuery(() => (me ? getSharedBookSummaries(me) : []), [me]);
  // Headline totals exclude archived people — that's the point of archiving.
  const totals = useQuery(() => getLedgerTotals());

  /**
   * Your own people and your shared books in one list, so the filters, the
   * three views and the search all treat a shared book like any other row.
   */
  const people = useMemo<Row[]>(() => {
    const own: Row[] = ownPeople.map((person) => ({
      ...person,
      key: `person:${person.person}`,
    }));

    const shared: Row[] = books.map((book) => ({
      // The book's own name leads, so a rename actually shows up here. The
      // other member's name is the fallback for an untitled book.
      person: book.name?.trim() || book.otherName || 'Shared book',
      balance: book.balance,
      gave: book.gave,
      took: book.took,
      entries: book.entries,
      lastDay: book.lastDay,
      pinned: book.pinned,
      archived: book.archived,
      dueDay: book.dueDay,
      // A book has a chat; a reminder goes there rather than to a number.
      phone: '',
      bookId: book.id,
      pending: book.pending,
      unread: book.unread,
      key: `book:${book.id}`,
    }));

    return [...own, ...shared].sort((a, b) => comparePeople(a, b, sort));
  }, [ownPeople, books, sort]);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  // The person whose options sheet is open, or null.
  const [sheetFor, setSheetFor] = useState<Row | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [dueFor, setDueFor] = useState<Row | null>(null);
  const [phoneFor, setPhoneFor] = useState<Row | null>(null);
  const [mergeFor, setMergeFor] = useState<Row | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The person being renamed, or deleted, and how far the delete has got:
  // stage 2 is the second warning, which only people with history ever see.
  const [renameFor, setRenameFor] = useState<Row | null>(null);
  // Renaming or leaving a shared book talks to the server, so unlike the purely
  // local person actions it has something to report when it fails.
  const setNotice = (message: string) => notify(message);

  const query = search.trim().toLowerCase();

  const counts = useMemo(() => {
    const tally = { all: 0, archived: 0, people: 0, shared: 0, get: 0, pay: 0, overdue: 0, settled: 0 } as Record<Filter, number>;
    for (const person of people) {
      for (const { key } of FILTERS) if (matchesFilter(person, key)) tally[key] += 1;
    }
    return tally;
  }, [people]);

  const inFilter = useMemo(
    () => people.filter((person) => matchesFilter(person, filter)),
    [people, filter]
  );

  // People come from the local database, which mirrors the cloud, so searching
  // returns the same results whether or not there's a connection.
  const visible = useMemo(
    () => (query ? inFilter.filter((p) => matchesQuery(p.person, query)) : inFilter),
    [inFilter, query]
  );

  // The archived view gets its own totals, since the headline ones leave it out.
  const archivedTotals = useMemo(() => {
    let receivable = 0;
    let payable = 0;
    for (const person of people) {
      if (!person.archived) continue;
      if (person.balance > 0) receivable += person.balance;
      else payable += -person.balance;
    }
    return { receivable, payable };
  }, [people]);

  // getLedgerTotals() only knows your own ledger, so fold the shared books in
  // — money owed through a shared book is still money owed. The dashboard uses
  // the same function, so the two screens can't disagree.
  const combinedTotals = useMemo(() => combineLedgerTotals(totals, books), [totals, books]);

  const shownTotals = filter === 'archived' ? archivedTotals : combinedTotals;
  const pinnedCount = visible.filter((p) => p.pinned).length;

  // A lone tile on the last grid row would stretch to full width, so pad the
  // data with a blank cell instead.
  const rows = useMemo(() => {
    if (view !== 'grid' || visible.length % 2 === 0) return visible;
    return [...visible, { ...visible[0], person: GRID_SPACER, key: GRID_SPACER }];
  }, [view, visible]);

  const openPerson = (person: string) =>
    router.push(`/person?person=${encodeURIComponent(person)}` as Href);

  /** A shared book opens its own live statement; a person opens theirs. */
  const open = (row: Row) =>
    row.bookId
      ? router.push(`/shared-book?id=${encodeURIComponent(row.bookId)}` as Href)
      : openPerson(row.person);

  // Both name dialogs report a rejected name in place, by returning the
  // reason, so a clash doesn't cost the user what they typed.
  const submitAdd = (name: string): string | void => {
    // A near-duplicate is the mistake that creates two half-balances for one
    // human, and the one place it is cheap to catch is before the second name
    // exists. Asked rather than refused: "Ali" and "Ali Bhai" really can be
    // two people.
    const similar = similarPerson(name, people);
    if (similar) {
      setAddOpen(false);
      confirm({
        title: `You already have ${similar}`,
        message: `Add ${name.trim()} as a separate person anyway? If they are the same person, keep ${similar} instead.`,
        confirmLabel: 'Add anyway',
        cancelLabel: `Keep ${similar}`,
        onConfirm: () => {
          try {
            createPerson(name);
          } catch (error) {
            setNotice((error as Error).message);
          }
        },
      });
      return;
    }

    try {
      createPerson(name);
    } catch (error) {
      return (error as Error).message;
    }
    setAddOpen(false);
  };

  const submitRename = (name: string): string | void => {
    if (!renameFor) return;

    if (renameFor.bookId) {
      // A book's name lives on the server, so this can't answer in place the
      // way a local rename does. Validate what we can, then report a failure
      // through the notice instead of the dialog.
      if (!name.trim()) return 'Enter a name.';
      const bookId = renameFor.bookId;
      setRenameFor(null);
      renameSharedBook(bookId, name).catch((error) =>
        setNotice(
          error instanceof SharedBookError
            ? error.message
            : 'Couldn’t rename the book. It needs a connection.'
        )
      );
      return;
    }

    let renamed: string;
    try {
      // It returns the name it actually stored, which is the one the scope has
      // to match — re-trimming here would be a second guess at its rules.
      renamed = renamePerson(renameFor.person, name);
    } catch (error) {
      return (error as Error).message;
    }
    // Their scope is their name, so it has to move with them — otherwise a
    // rename quietly uncovers a balance they had hidden.
    renameBalanceScope(personScope(renameFor.person), personScope(renamed));
    setRenameFor(null);
  };


  /**
   * Leaving a book is one question. Deleting a person is one question too,
   * unless they carry entries or an open balance — then it asks again, because
   * that is the only case where saying yes actually destroys something.
   */
  const askDelete = (row: Row) => {
    if (row.bookId) {
      const bookId = row.bookId;
      confirm({
        title: `Leave ${row.person}?`,
        message:
          'You\u2019ll stop seeing this book and its entries on all your devices. The other person keeps the book and its full history.',
        confirmLabel: 'Leave',
        destructive: true,
        onConfirm: () =>
          leaveSharedBook(bookId, me).catch((error) =>
            setNotice(
              error instanceof SharedBookError
                ? error.message
                : 'Couldn\u2019t leave the book. It needs a connection.'
            )
          ),
      });
      return;
    }

    if (!needsSecondWarning(row)) {
      confirm({
        title: `Delete ${row.person}?`,
        message: 'They have no entries yet, so nothing else is lost.',
        confirmLabel: 'Delete',
        destructive: true,
        onConfirm: () => deletePerson(row.person),
      });
      return;
    }

    confirm({
      title: `Delete ${row.person}?`,
      message: `This removes ${deleteCost(row)}. Archive them instead to clear the list and keep the history.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () =>
        confirm({
          title: `Delete ${row.person} for good?`,
          message: `Last check: ${deleteCost(row)} will be gone from every device, and there is no undo.`,
          confirmLabel: 'Delete forever',
          cancelLabel: 'No, keep them',
          destructive: true,
          onConfirm: () => deletePerson(row.person),
        }),
    });
  };

  /**
   * Clear someone off in one tap.
   *
   * Records the entry that cancels the balance, in whichever direction does
   * it: if they owe you, what happens is that you RECEIVE it, so the entry is
   * a "took". The shared-book version writes the same thing into the book,
   * where the member who owes is the one recorded as having paid.
   *
   * Undoable, like every other write in this app — a settle made by a
   * mis-aimed swipe should cost one tap to put back.
   */
  const settle = (row: Row) => {
    const amount = Math.abs(row.balance);
    if (amount < SETTLED_EPSILON) return;

    const owesYou = row.balance > 0;
    const title = `Settle up with ${row.person}?`;
    const message = owesYou
      ? `Records that ${row.person} paid you ${formatMoney(amount)}, bringing the balance to zero.`
      : `Records that you paid ${row.person} ${formatMoney(amount)}, bringing the balance to zero.`;

    confirm({
      title,
      message,
      confirmLabel: 'Record it',
      onConfirm: () => {
        if (row.bookId) {
          const bookId = row.bookId;
          const otherId = getBookMembers(bookId).find((m) => m.user_id !== me)?.user_id ?? null;
          if (!otherId) {
            setNotice('Nobody has joined this book yet.');
            return;
          }
          const entryId = addSharedEntry({
            bookId,
            payerId: owesYou ? otherId : me,
            amount,
            note: 'Settled up',
          });
          offerUndo('Settled up', () => deleteSharedEntry(entryId));
          return;
        }

        const entryId = addLedgerEntry({
          person: row.person,
          direction: owesYou ? 'took' : 'gave',
          amount,
          note: 'Settled up',
        });
        // A date on a balance of zero is a promise about nothing.
        const hadDue = row.dueDay;
        setPersonDue(row.person, '');
        offerUndo('Settled up', () => {
          deleteLedgerEntry(entryId);
          if (hadDue) setPersonDue(row.person, hadDue);
        });
      },
    });
  };

  const chooseDue = (row: Row, day: string) =>
    row.bookId ? setBookDue(row.bookId, day) : setPersonDue(row.person, day);

  /**
   * Open WhatsApp on the conversation with them, with the nudge already
   * written.
   *
   * `wa.me` rather than the `whatsapp://` scheme: it opens the app when it is
   * installed and the web page when it isn't, so there is no case where the
   * tap does nothing. The number has to carry its country code — the app
   * deliberately does not guess one, because guessing wrong sends a stranger
   * a message about money.
   */
  const remindOnWhatsApp = (row: Row) => {
    const digits = row.phone.replace(/[^\d]/g, '');
    if (!digits) return;
    const amount = Math.abs(row.balance);
    const line =
      row.balance > 0
        ? `Hey ${row.person} — there’s ${formatMoney(amount)} pending between us whenever you get a chance 🙂`
        : `Hey ${row.person} — just so it isn’t forgotten, I owe you ${formatMoney(amount)}.`;
    void Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(line)}`).catch(() =>
      setNotice('Couldn’t open WhatsApp for that number.')
    );
  };

  /**
   * Let a balance go.
   *
   * The same entry a settle writes, with a different note and a different
   * meaning: "they paid" and "I am not chasing this" are two different facts,
   * and a ledger that recorded the second as the first would be wrong about
   * what happened.
   */
  const writeOff = (row: Row) => {
    const amount = Math.abs(row.balance);
    if (amount < SETTLED_EPSILON || row.bookId) return;

    confirm({
      title: `Write off ${formatMoney(amount)}?`,
      message:
        row.balance > 0
          ? `Clears what ${row.person} owes you without recording a payment. The entry says it was written off.`
          : `Clears what you owe ${row.person} without recording a payment. The entry says it was written off.`,
      confirmLabel: 'Write it off',
      onConfirm: () => {
        const entryId = addLedgerEntry({
          person: row.person,
          direction: row.balance > 0 ? 'took' : 'gave',
          amount,
          note: 'Written off',
        });
        setPersonDue(row.person, '');
        offerUndo('Written off', () => deleteLedgerEntry(entryId));
      },
    });
  };

  const submitMerge = (name: string): string | void => {
    if (!mergeFor) return;
    const target = findPerson(name);
    if (!target) return 'Nobody on your list goes by that name.';
    if (target.toLowerCase() === mergeFor.person.toLowerCase()) return 'That is the same person.';

    const from = mergeFor;
    setMergeFor(null);
    confirm({
      title: `Merge ${from.person} into ${target}?`,
      message: `Every entry filed under ${from.person} moves to ${target}, and the two balances become one. There is no undo.`,
      confirmLabel: 'Merge',
      destructive: true,
      onConfirm: () => {
        mergePeople(from.person, target);
        renameBalanceScope(personScope(from.person), personScope(target));
      },
    });
  };

  /**
   * A payment that isn't the whole balance.
   *
   * Opens the form rather than writing anything: the amount is the one thing
   * this screen cannot guess, and the direction it pre-selects is the one
   * that reduces what is outstanding — which is what a payment is.
   */
  const recordPayment = (row: Row) => {
    if (row.bookId) {
      // Whoever owes is the one about to pay, so that is who the form opens
      // on — the same guess the direction below makes for your own ledger.
      const otherId = getBookMembers(row.bookId).find((m) => m.user_id !== me)?.user_id ?? null;
      const payer = row.balance > 0 ? otherId : me;
      router.push(
        `/shared-entry?book=${encodeURIComponent(row.bookId)}` +
          (payer ? `&payer=${encodeURIComponent(payer)}` : '') as Href
      );
      return;
    }
    const direction = row.balance > 0 ? 'took' : 'gave';
    router.push(
      `/ledger?person=${encodeURIComponent(row.person)}&direction=${direction}` as Href
    );
  };

  /**
   * A nudge, not a statement.
   *
   * "Share balance" sends the standing of the account; this sends the ask.
   * They are different messages for different moments, and the wording of the
   * second one is the part people agonise over — so it goes out through the
   * share sheet, where it can still be edited in whatever app receives it.
   */
  const remind = (row: Row) => {
    const amount = Math.abs(row.balance);
    if (amount < SETTLED_EPSILON) {
      setNotice('That balance is already settled.');
      return;
    }
    // A shared book has its own chat, and a reminder sent there reaches them
    // as a proper "… sent a balance reminder" notification — so it goes there,
    // drafted and still editable, instead of out through the share sheet.
    if (row.bookId) {
      router.push(`/shared-chat?book=${encodeURIComponent(row.bookId)}&remind=1` as Href);
      return;
    }
    const line =
      row.balance > 0
        ? `Hey ${row.person} — there’s ${formatMoney(amount)} pending between us whenever you get a chance 🙂`
        : `Hey ${row.person} — just so it isn’t forgotten, I owe you ${formatMoney(amount)}.`;
    void Share.share({ message: line }).catch(() => {
      // Dismissed, or nothing accepted it.
    });
  };

  /** Archiving with a way back, the way every other write in the app has one. */
  const archive = (row: Row, next: boolean) => {
    if (row.bookId) setBookArchived(row.bookId, next);
    else setPersonArchived(row.person, next);
    offerUndo(next ? `Archived ${row.person}` : `${row.person} is back`, () => {
      if (row.bookId) setBookArchived(row.bookId, !next);
      else setPersonArchived(row.person, !next);
    });
  };

  /**
   * Covering a balance from the list itself, so you don't have to open someone
   * to hide them. Same policy as the eye on their statement.
   */
  const balanceAction = (row: Row): SheetAction => {
    const scope = rowScope(row);
    const covered = isBalanceCovered(scope);
    return {
      label: covered ? 'Show balance' : 'Hide balance',
      icon: covered ? 'visibility' : 'visibility-off',
      onPress: () => toggleBalanceCover(scope, balancePin && hasPin),
    };
  };

  /** The money actions, which both kinds of row get in the same order. */
  const moneyActions = (person: Row): SheetAction[] => {
    const open = Math.abs(person.balance) >= SETTLED_EPSILON;
    const actions: SheetAction[] = [];
    if (open) {
      actions.push({
        label: `Settle up · ${formatMoney(Math.abs(person.balance))}`,
        icon: 'check-circle-outline',
        onPress: () => settle(person),
      });
    }
    actions.push({
      label: 'Record a payment',
      icon: 'add-card',
      onPress: () => recordPayment(person),
    });
    if (open && person.phone) {
      actions.push({
        label: 'Remind on WhatsApp',
        icon: 'chat',
        onPress: () => remindOnWhatsApp(person),
      });
    }
    if (open) {
      actions.push({
        label: person.bookId ? 'Send a balance reminder' : 'Send a reminder',
        icon: 'notifications-active',
        onPress: () => remind(person),
      });
    }
    if (open) {
      const due = dueState(person);
      actions.push({
        label: due ? `Expected by · ${formatRelativeDay(person.dueDay)}` : 'Expect it back by…',
        icon: 'event',
        onPress: () => setTimeout(() => setDueFor(person), 220),
      });
    }
    if (open && !person.bookId) {
      actions.push({
        label: `Write off · ${formatMoney(Math.abs(person.balance))}`,
        icon: 'do-not-disturb-on',
        onPress: () => writeOff(person),
      });
    }
    return actions;
  };

  const sheetActions = (person: Row): SheetAction[] =>
    isShared(person)
      ? [
          ...moneyActions(person),
          balanceAction(person),
          {
            label: person.pinned ? 'Unpin from top' : 'Pin to top',
            icon: 'push-pin',
            onPress: () => setBookPinned(person.bookId!, !person.pinned),
          },
          {
            label: person.archived ? 'Unarchive' : 'Archive',
            icon: person.archived ? 'unarchive' : 'archive',
            onPress: () => archive(person, !person.archived),
          },
          {
            label: 'Rename',
            icon: 'edit',
            onPress: () => setRenameFor(person),
          },
          {
            label: 'Open shared book',
            icon: 'groups',
            onPress: () => open(person),
          },
          {
            label: person.unread ? `Chat (${person.unread} unread)` : 'Chat',
            icon: 'chat-bubble-outline',
            onPress: () =>
              router.push(`/shared-chat?book=${encodeURIComponent(person.bookId!)}` as Href),
          },
          {
            label: 'Share balance',
            icon: 'share',
            onPress: () => void shareBookBalance(person.bookId!),
          },
          {
            // Leaving, not deleting: the other member's copy is not yours to
            // remove, so the wording has to say what actually happens.
            label: 'Leave book',
            icon: 'logout',
            destructive: true,
            onPress: () => askDelete(person),
          },
        ]
      : [
          ...moneyActions(person),
          balanceAction(person),
          {
            label: person.pinned ? 'Unpin from top' : 'Pin to top',
            icon: 'push-pin',
            onPress: () => setPersonPinned(person.person, !person.pinned),
          },
          {
            label: person.archived ? 'Unarchive' : 'Archive',
            icon: person.archived ? 'unarchive' : 'archive',
            onPress: () => archive(person, !person.archived),
          },
          {
            label: 'Rename',
            icon: 'edit',
            onPress: () => setRenameFor(person),
          },
          {
            label: 'Open statement',
            icon: 'receipt-long',
            onPress: () => openPerson(person.person),
          },
          {
            label: person.phone ? `Number · ${person.phone}` : 'Add a number…',
            icon: 'phone',
            onPress: () => setTimeout(() => setPhoneFor(person), 220),
          },
          {
            label: 'Merge into someone…',
            icon: 'merge-type',
            onPress: () => setTimeout(() => setMergeFor(person), 220),
          },
          {
            label: 'Share balance',
            icon: 'share',
            onPress: () => void sharePersonBalance(person.person),
          },
          {
            label: 'Delete',
            icon: 'delete-outline',
            destructive: true,
            onPress: () => askDelete(person),
          },
        ];

  const rowProps = (person: Row) => ({
    person,
    onPress: () => open(person),
    onLongPress: () => setSheetFor(person),
  });

  /**
   * The two things this page is opened to do, on a swipe.
   *
   * Settle is on the right-pull because it is the happy one and the one that
   * gets used; archive is on the left-pull, further from the thumb's resting
   * sweep. Neither appears where it would do nothing — there is no settling
   * a balance of zero.
   */
  const swipeActions = (person: Row): { left?: SwipeAction; right?: SwipeAction } => ({
    left:
      Math.abs(person.balance) >= SETTLED_EPSILON
        ? {
            icon: 'check-circle-outline',
            label: 'Settle',
            color: MoneyColors.in,
            onTrigger: () => settle(person),
          }
        : undefined,
    right: {
      icon: person.archived ? 'unarchive' : 'archive',
      label: person.archived ? 'Restore' : 'Archive',
      color: theme.textSecondary,
      onTrigger: () => archive(person, !person.archived),
    },
  });

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        {/* The name search lives in the list header, so it stays in view on
            its own — but the list under it should stop at the keyboard
            rather than scrolling behind it. */}
        <KeyboardAvoider style={styles.flexFill}>
          <FlatList
            // FlatList needs a fresh instance when the column count changes.
            key={view}
            data={rows}
            numColumns={view === 'grid' ? 2 : 1}
            columnWrapperStyle={view === 'grid' ? styles.gridRow : undefined}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            // The list mirrors the cloud, so the gesture everybody already
            // tries on a synced list should do what they expect. `force`
            // because this one was asked for by hand rather than scheduled.
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void refreshNow(true).finally(() => setRefreshing(false));
                }}
              />
            }
            ListHeaderComponent={
              <View style={styles.header}>
                <View style={styles.titleRow}>
                  <View style={styles.titleBlock}>
                    <ThemedText type="title" style={styles.title}>
                      Loans
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Who owes you, and who you owe
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => router.push('/split' as Href)}
                    style={({ pressed }) => [
                      styles.addPerson,
                      theme.glass,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Split a bill between people">
                    <MaterialIcons name="call-split" size={21} color={theme.accentTint} />
                  </Pressable>
                  <Pressable
                    onPress={() => router.push('/shared-new' as Href)}
                    style={({ pressed }) => [
                      styles.addPerson,
                      theme.glass,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Create or join a shared book">
                    <MaterialIcons name="menu-book" size={21} color={theme.accentTint} />
                  </Pressable>
                  <Pressable
                    onPress={() => setAddOpen(true)}
                    style={({ pressed }) => [
                      styles.addPerson,
                      theme.glass,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Add a person">
                    <MaterialIcons name="person-add" size={21} color={theme.accentTint} />
                  </Pressable>
                </View>

                {/* The tiles are the filters. Reading "you'll get 12,400"
                    and then hunting for the chip that shows you who is a
                    step this screen was making people take for no reason. */}
                <View style={styles.tiles}>
                  <Pressable
                    onPress={() => setFilter(filter === 'get' ? 'all' : 'get')}
                    style={({ pressed }) => [
                      styles.tile,
                      theme.glass,
                      filter === 'get' && { borderColor: MoneyColors.in, borderWidth: 1 },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filter === 'get' }}
                    accessibilityLabel="Show only people who owe you">
                    <View style={styles.tileHead}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.tileHeadText}>
                        {filter === 'archived' ? 'Archived · you’ll get' : 'You’ll get'}
                      </ThemedText>
                      <BalanceEye scope={TOTAL_RECEIVABLE_SCOPE} size={22} what="what you’ll get" />
                    </View>
                    <ThemedText style={[styles.tileValue, { color: MoneyColors.in }]}>
                      {getCovered ? HIDDEN_AMOUNT : formatMoney(shownTotals.receivable)}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => setFilter(filter === 'pay' ? 'all' : 'pay')}
                    style={({ pressed }) => [
                      styles.tile,
                      theme.glass,
                      filter === 'pay' && { borderColor: MoneyColors.out, borderWidth: 1 },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filter === 'pay' }}
                    accessibilityLabel="Show only people you owe">
                    <View style={styles.tileHead}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.tileHeadText}>
                        {filter === 'archived' ? 'Archived · you’ll pay' : 'You’ll pay'}
                      </ThemedText>
                      <BalanceEye scope={TOTAL_PAYABLE_SCOPE} size={22} what="what you’ll pay" />
                    </View>
                    <ThemedText style={[styles.tileValue, { color: MoneyColors.out }]}>
                      {payCovered ? HIDDEN_AMOUNT : formatMoney(shownTotals.payable)}
                    </ThemedText>
                  </Pressable>
                </View>

                <View style={styles.searchRow}>
                  <View style={[styles.searchBar, theme.glass]}>
                    <MaterialIcons name="search" size={18} color={theme.textSecondary} />
                    <TextInput
                      value={search}
                      onChangeText={setSearch}
                      // Short enough for one line beside the view switch on a
                      // narrow phone; a longer hint wrapped onto two.
                      placeholder="Search by name"
                      placeholderTextColor={theme.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      multiline={false}
                      numberOfLines={1}
                      accessibilityLabel="Search people and shared books"
                      style={[styles.searchInput, { color: theme.text }]}
                    />
                    {search.length > 0 && (
                      <Pressable
                        onPress={() => setSearch('')}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Clear search">
                        <MaterialIcons name="close" size={18} color={theme.textSecondary} />
                      </Pressable>
                    )}
                  </View>

                  <Pressable
                    onPress={() => setSortOpen(true)}
                    style={({ pressed }) => [
                      styles.sortBtn,
                      theme.glass,
                      sort !== 'recent' && { borderColor: theme.accentTint, borderWidth: 1 },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Sort: ${
                      PEOPLE_SORTS.find((option) => option.key === sort)?.label ?? 'Recent'
                    }`}>
                    <MaterialIcons
                      name="swap-vert"
                      size={18}
                      color={sort === 'recent' ? theme.textSecondary : theme.accentTint}
                    />
                  </Pressable>

                  <View style={[styles.viewSwitch, theme.glass]}>
                    {VIEWS.map(({ key, icon, label }) => {
                      const selected = key === view;
                      return (
                        <Pressable
                          key={key}
                          onPress={() => setPeopleView(key)}
                          style={[
                            styles.viewButton,
                            selected && { backgroundColor: theme.backgroundSelected },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={label}
                          accessibilityState={{ selected }}>
                          <MaterialIcons
                            name={icon}
                            size={18}
                            color={selected ? theme.accent : theme.textSecondary}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.chipRow}
                  contentContainerStyle={styles.chips}>
                  {FILTERS.map(({ key, label }) => (
                    <GlassChip
                      key={key}
                      // Archived is a separate shelf rather than a slice of
                      // balances, so it gets an icon to set it apart.
                      icon={key === 'archived' ? 'archive' : undefined}
                      label={`${label} ${counts[key]}`}
                      selected={key === filter}
                      onPress={() => setFilter(key)}
                    />
                  ))}
                </ScrollView>

                {query.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.searchMeta}>
                    {visible.length} of {inFilter.length}{' '}
                    {inFilter.length === 1 ? 'person' : 'people'}
                    {status === 'offline' ? ' · offline, searching saved data' : ''}
                  </ThemedText>
                )}

              </View>
            }
            renderItem={({ item, index }) => {
              if (item.person === GRID_SPACER) return <View style={styles.gridItem} />;

              // Section labels only in list view: the grid has a pin badge on the
              // tile, and the table has its own column header to sit under.
              const showPinnedLabel = view === 'list' && index === 0 && !!item.pinned;
              const showOthersLabel =
                view === 'list' && !item.pinned && index > 0 && !!visible[index - 1].pinned;

              return (
                <View style={view === 'grid' ? styles.gridItem : undefined}>
                  {showPinnedLabel && <SectionLabel icon="push-pin" text="Pinned" />}
                  {showOthersLabel && (
                    <SectionLabel icon="people-outline" text="Everyone else" spaced />
                  )}
                  {view === 'grid' ? (
                    <PersonTile {...rowProps(item)} />
                  ) : (
                    // Only in list view: a tile is half a row wide, which is
                    // not enough travel for a swipe to read as deliberate.
                    <SwipeRow {...swipeActions(item)} style={styles.swipeWrap}>
                      <PersonRow {...rowProps(item)} onMore={() => setSheetFor(item)} />
                    </SwipeRow>
                  )}
                </View>
              );
            }}
            ListFooterComponent={
              visible.length > 0 && pinnedCount === 0 && filter !== 'archived' ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                  Tip: press and hold anyone to pin, rename, archive or delete them.
                </ThemedText>
              ) : null
            }
            ListEmptyComponent={
              <EmptyState
                filter={filter}
                search={search.trim()}
                hasAnyone={people.length > 0}
                onAddPerson={() => setAddOpen(true)}
                onAddShared={() => router.push('/shared-new' as Href)}
              />
            }
          />
        </KeyboardAvoider>
      </SafeAreaView>

      <AddButton href={'/ledger' as Href} />

      <ActionSheet
        visible={sheetFor !== null}
        title={sheetFor?.person}
        actions={sheetFor ? sheetActions(sheetFor) : []}
        onClose={() => setSheetFor(null)}
      />

      <ActionSheet
        visible={dueFor !== null}
        title={dueFor ? `Expect ${dueFor.person} to settle` : 'Expect it back'}
        actions={[
          ...DUE_CHOICES.map((choice) => ({
            label: choice.label,
            icon: 'event' as const,
            onPress: () => dueFor && chooseDue(dueFor, addDays(todayKey(), choice.days)),
          })),
          ...(dueFor?.dueDay
            ? [
                {
                  label: 'No date',
                  icon: 'event-busy' as const,
                  destructive: true,
                  onPress: () => dueFor && chooseDue(dueFor, ''),
                },
              ]
            : []),
        ]}
        onClose={() => setDueFor(null)}
      />

      <PromptModal
        visible={phoneFor !== null}
        title="Their number"
        message="Include the country code, e.g. +92 300 1234567 — the app will not guess one."
        initialValue={phoneFor?.phone ?? ''}
        placeholder="+92 300 1234567"
        confirmLabel="Save"
        onSubmit={(value) => {
          if (phoneFor) setPersonPhone(phoneFor.person, value);
          setPhoneFor(null);
        }}
        onCancel={() => setPhoneFor(null)}
      />

      <PromptModal
        visible={mergeFor !== null}
        title={`Merge ${mergeFor?.person ?? ''}`}
        message="Type the name to merge them INTO. Their entries move across and the two balances become one."
        placeholder="Name on your list"
        confirmLabel="Merge"
        onSubmit={submitMerge}
        onCancel={() => setMergeFor(null)}
      />

      <ActionSheet
        visible={sortOpen}
        title="Sort by"
        actions={PEOPLE_SORTS.map((option) => ({
          label: option.key === sort ? `${option.label}  ✓` : option.label,
          icon:
            option.key === 'amount'
              ? 'trending-up'
              : option.key === 'oldest'
                ? 'hourglass-bottom'
                : option.key === 'due'
                  ? 'event'
                  : option.key === 'name'
                    ? 'sort-by-alpha'
                    : 'schedule',
          onPress: () => setPeopleSort(option.key),
        }))}
        onClose={() => setSortOpen(false)}
      />

      <PromptModal
        visible={addOpen}
        title="Add a person"
        message="They sit on your list at zero until you record a give or take."
        placeholder="Name"
        confirmLabel="Add"
        onSubmit={submitAdd}
        onCancel={() => setAddOpen(false)}
      />

      <PromptModal
        visible={renameFor !== null}
        title="Rename"
        message={
          renameFor?.bookId
            ? 'Both of you will see the new name.'
            : `Renames ${renameFor?.person ?? ''} on every entry of theirs.`
        }
        initialValue={renameFor?.person ?? ''}
        placeholder="Name"
        confirmLabel="Rename"
        onSubmit={submitRename}
        onCancel={() => setRenameFor(null)}
      />
    </ThemedView>
  );
}

/**
 * The round initial, with a small badge on the corner when the row is a book
 * both people can see and write to.
 *
 * The badge used to be a filled "Shared" pill sitting in the text. In a row it
 * competed with the name for width and won, cutting long names down to "Jo…";
 * in a tile it took the place of the "Owes you / You owe" line, so a shared
 * book was the one kind of row that never said which way the money went.
 * Hanging it off the avatar costs no layout width at all.
 */
function Avatar({
  initial,
  color,
  size,
  shared,
  unread = 0,
}: {
  initial: string;
  color: string;
  size: number;
  shared: boolean;
  /** Unread messages in this book, shown opposite the shared mark. */
  unread?: number;
}) {
  const theme = useTheme();
  const badge = Math.round(size * 0.42);

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, backgroundColor: theme.backgroundSelected },
      ]}>
      <ThemedText style={[styles.avatarInitial, { fontSize: Math.round(size * 0.44), color }]}>
        {initial}
      </ThemedText>
      {shared && (
        <View
          style={[
            styles.avatarBadge,
            {
              width: badge,
              height: badge,
              borderRadius: badge,
              backgroundColor: theme.accent,
              // A bright ring, not the card's fill: the card is translucent
              // now, so its own colour would leave the badge with no edge.
              borderColor: 'rgba(255,255,255,0.55)',
            },
          ]}>
          <MaterialIcons name="group" size={Math.round(badge * 0.64)} color="#ffffff" />
        </View>
      )}
      {/* Top corner, opposite the shared mark: the two never collide, and the
          count costs the row no width — the same reason the mark hangs here. */}
      <UnreadBadge count={unread} style={styles.avatarUnread} />
    </View>
  );
}

/** A small "Pinned" / "Everyone else" divider inside the list. */
function SectionLabel({
  icon,
  text,
  spaced,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  text: string;
  spaced?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.sectionLabel, spaced && styles.sectionLabelSpaced]}>
      <MaterialIcons name={icon} size={14} color={theme.textSecondary} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabelText}>
        {text}
      </ThemedText>
    </View>
  );
}

/** Everything a row needs to describe a person's standing, in one place. */
function useStanding(person: Row) {
  const theme = useTheme();
  const settled = isSettled(person);
  const fresh = isFresh(person);
  const owesYou = person.balance > 0;
  return {
    settled,
    fresh,
    owesYou,
    color: settled ? theme.textSecondary : owesYou ? MoneyColors.in : MoneyColors.out,
    // Worked out once, for both views: a shared book used to lose this line
    // to its badge and so never said which way the money went.
    label: person.pending
      ? 'Waiting to join'
      : fresh
        ? 'No entries yet'
        : settled
          ? 'Settled up'
          : owesYou
            ? 'Owes you'
            : 'You owe',
    initial: person.person.trim().charAt(0).toUpperCase() || '?',
  };
}

type RowProps = {
  person: Row;
  onPress: () => void;
  onLongPress: () => void;
};

/** The roomy default row: avatar, name, standing, amount. */
function PersonRow({ person, onPress, onLongPress, onMore }: RowProps & { onMore: () => void }) {
  const theme = useTheme();
  const covered = useBalanceCovered(rowScope(person));
  const { settled, fresh, color, label, initial } = useStanding(person);
  const shared = isShared(person);
  const age = daysSince(person.lastDay);
  const due = dueState(person);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        styles.card,
        theme.glass,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${person.person}${shared ? ', shared book' : ''}. ${label}.${
        person.unread ? ` ${person.unread} unread messages.` : ''
      }`}>
      <Avatar
        initial={initial}
        color={settled ? theme.textSecondary : color}
        size={46}
        shared={shared}
        unread={person.unread}
      />

      <View style={styles.middle}>
        {/* The name now has the whole row to itself. */}
        <View style={styles.nameRow}>
          {!!person.pinned && <MaterialIcons name="push-pin" size={14} color={theme.accentTint} />}
          <ThemedText type="smallBold" numberOfLines={1} style={styles.personName}>
            {person.person}
          </ThemedText>
        </View>
        <View style={styles.standingRow}>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={1}
            style={styles.standingText}>
            {fresh || person.pending ? label : `${label} · ${formatRelativeDay(person.lastDay)}`}
          </ThemedText>
          {/* A date they actually promised beats a count of days nobody
              agreed to, so the due state wins where there is one. */}
          {due ? (
            <View
              style={[
                styles.agePill,
                { backgroundColor: due.late ? MoneyColors.out : theme.backgroundSelected },
              ]}>
              <ThemedText
                type="small"
                style={[styles.ageText, { color: due.late ? '#ffffff' : theme.textSecondary }]}>
                {due.text}
              </ThemedText>
            </View>
          ) : (
            /* The thing a loans list is for and never said: how long this has
               been sitting there. Only past a month, so it informs rather
               than nags. */
            !settled &&
            !fresh &&
            age >= AGEING_DAYS && (
              <View style={[styles.agePill, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="small" style={[styles.ageText, { color: MoneyColors.out }]}>
                  {age >= 365 ? `${Math.floor(age / 365)}y` : age >= 60 ? `${Math.floor(age / 30)}mo` : `${age}d`}
                </ThemedText>
              </View>
            )
          )}
        </View>
      </View>

      <View style={styles.right}>
        <ThemedText type="smallBold" style={[styles.balanceValue, { color }]} numberOfLines={1}>
          {covered ? HIDDEN_AMOUNT : formatMoney(Math.abs(person.balance))}
        </ThemedText>
        <Pressable
          onPress={onMore}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Options for ${person.person}`}>
          <MaterialIcons name="more-vert" size={20} color={theme.textSecondary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

/** Half-width tile for the two-column grid. */
function PersonTile({ person, onPress, onLongPress }: RowProps) {
  const theme = useTheme();
  const covered = useBalanceCovered(rowScope(person));
  const { settled, color, label, initial } = useStanding(person);
  const shared = isShared(person);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        styles.tileCard,
        theme.glass,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${person.person}${shared ? ', shared book' : ''}. ${label}.`}>
      {!!person.pinned && (
        <MaterialIcons name="push-pin" size={15} color={theme.accentTint} style={styles.tilePin} />
      )}
      <Avatar
        initial={initial}
        color={settled ? theme.textSecondary : color}
        size={48}
        shared={shared}
        unread={person.unread}
      />
      <ThemedText type="smallBold" numberOfLines={1} style={styles.tileName}>
        {person.person}
      </ThemedText>
      {/* Every tile says which way the money goes, shared or not. */}
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.tileLabel}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={[styles.tileAmount, { color }]} numberOfLines={1}>
        {covered ? HIDDEN_AMOUNT : formatMoney(Math.abs(person.balance))}
      </ThemedText>
    </Pressable>
  );
}

function EmptyAction({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.emptyAction,
        { backgroundColor: theme.accent },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button">
      <ThemedText type="smallBold" style={{ color: '#ffffff' }}>{label}</ThemedText>
    </Pressable>
  );
}

function EmptyState({
  filter,
  search,
  hasAnyone,
  onAddPerson,
  onAddShared,
}: {
  filter: Filter;
  search: string;
  hasAnyone: boolean;
  onAddPerson: () => void;
  onAddShared: () => void;
}) {
  const theme = useTheme();
  const [icon, title, hint] = search
    ? ['search-off', 'No matches', `No results for “${search}” in this view.`]
    : !hasAnyone
      ? ['receipt-long', 'No entries yet', 'Add a person or create a shared book to get started.']
      : filter === 'people'
        ? ['person-off', 'No people yet', 'Add someone to track personal loans.']
        : filter === 'shared'
          ? ['menu-book', 'No shared books yet', 'Create a book or join one with an invite code.']
          : filter === 'archived'
            ? ['folder-off', 'Nothing archived', 'Press and hold an item to archive it. Its history is kept.']
            : filter === 'get'
              ? ['check-circle', 'Nobody owes you', 'Everyone you lent to has paid you back.']
              : filter === 'pay'
                ? ['check-circle', 'You owe nobody', 'You are all square with everyone.']
                : filter === 'settled'
                  ? ['receipt-long', 'Nobody settled yet', 'Items appear here once their balance reaches zero.']
                  : ['receipt-long', 'No entries here', 'Add an entry to start tracking a balance.'];

  return (
    <View style={styles.empty}>
      <MaterialIcons
        name={icon as React.ComponentProps<typeof MaterialIcons>['name']}
        size={34}
        color={theme.textSecondary}
        style={styles.emptyIcon}
      />
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
        {hint}
      </ThemedText>
      {!search && (filter === 'people' || (filter === 'all' && !hasAnyone)) && (
        <EmptyAction label="Add a person" onPress={onAddPerson} />
      )}
      {!search && (filter === 'shared' || (filter === 'all' && !hasAnyone)) && (
        <EmptyAction label="Create or join a shared book" onPress={onAddShared} />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  flexFill: {
    flex: 1,
  },
  sortBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeWrap: {
    marginBottom: Spacing.two,
  },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  standingText: {
    flexShrink: 1,
  },
  agePill: {
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  ageText: {
    fontSize: 11,
  },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    // The glass tab bar is translucent and absolute, so this screen runs the
    // full height and has to clear both the bar and the floating Add button
    // sitting above it.
    paddingBottom: BottomTabInset + Spacing.six,
  },
  header: {
    // One rhythm for the whole header. Each block used to carry its own
    // margin, which stacked on top of this gap and left uneven steps between
    // the title, the tiles, the search and the chips.
    gap: Spacing.two,
    paddingTop: Spacing.two,
    // Matches the gap between two cards, so the chips sit the same distance
    // from the first row as the rows sit from each other.
    paddingBottom: Spacing.two,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  titleBlock: {
    flex: 1,
    gap: Spacing.one,
  },
  addPerson: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
  },
  tiles: {
    flexDirection: 'row',
    gap: Spacing.two,
    // The only block that earns more than the header gap: it follows the
    // 32px title, which needs a little air under it.
    marginTop: Spacing.one,
  },
  tile: {
    flex: 1,
    // A shorter tile wants a tighter corner — Radius.card on this height
    // read as a pill with the ends cut off.
    borderRadius: Radius.medium,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 1,
  },
  /** Label and its eye share a line, so the tile grows by the button, not a row. */
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tileHeadText: {
    flex: 1,
  },
  tileValue: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    // Both children now set their own height, so there is nothing to stretch.
    alignItems: 'center',
    gap: Spacing.two,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // Fixed rather than grown from the input's padding: the bar and the view
    // switch beside it have to agree, and a TextInput's intrinsic height
    // differs between the platforms.
    height: 40,
    // Full round, so it reads as one family with the filter chips below it
    // instead of as a box.
    borderRadius: Radius.full,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    // The bar sets the height; padding here would fight it.
    paddingVertical: 0,
    fontSize: 14,
  },
  chipRow: {
    // Bleed to the screen edges so chips scroll out of view rather than
    // being cut off at the content padding.
    marginHorizontal: -Spacing.four,
  },
  chips: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  // Matches the search bar's height and corners, so the two read as one row.
  viewSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    // Same height as the search bar it sits beside: 3 + 34 + 3.
    height: 40,
    borderRadius: Radius.full,
    padding: 3,
    gap: Spacing.half,
  },
  viewButton: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchMeta: {
    // Tucked up under the chips: the count belongs to the search above it,
    // not to the list below.
    marginTop: -Spacing.one,
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  sectionLabelSpaced: {
    paddingTop: Spacing.two,
  },
  sectionLabelText: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
    // The gap below lives on <SwipeRow> instead, so the panel revealed by a
    // swipe stops at the card's own edge rather than bleeding into the gap.
  },
  avatar: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontWeight: '700',
  },
  // The same -2 the shared mark below hangs on, rather than further out: an
  // avatar is a rounded, filled view, and Android clips what overflows one.
  avatarUnread: {
    position: 'absolute',
    right: -2,
    top: -2,
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  personName: {
    fontSize: 16,
    flexShrink: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  balanceValue: {
    fontSize: 16,
  },
  gridRow: {
    gap: Spacing.two,
  },
  gridItem: {
    flex: 1,
    minWidth: 0,
  },
  tileCard: {
    flex: 1,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    marginBottom: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tilePin: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
  },
  tileName: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: Spacing.two,
    alignSelf: 'stretch',
  },
  tileLabel: {
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  tileAmount: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: Spacing.one,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  hint: {
    textAlign: 'center',
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  pressed: {
    opacity: 0.7,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.six,
  },
  emptyIcon: {
    marginBottom: Spacing.two,
  },
  emptyAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
    marginTop: Spacing.one,
  },
  emptyHint: {
    textAlign: 'center',
  },
});


