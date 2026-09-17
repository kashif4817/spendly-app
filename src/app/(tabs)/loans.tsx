import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { AddButton } from '@/components/add-button';
import { ConfirmModal } from '@/components/confirm-modal';
import { PromptModal } from '@/components/prompt-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  createPerson,
  deletePerson,
  getCurrentUserId,
  getLedgerTotals,
  getPeople,
  getSharedBookSummaries,
  renamePerson,
  setBookArchived,
  setBookPinned,
  setPersonArchived,
  setPersonPinned,
  type PersonBalance,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { usePeopleView } from '@/hooks/use-people-view';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay } from '@/lib/date';
import { formatCompact, formatMoney } from '@/lib/money';
import { setPeopleView, type PeopleView } from '@/lib/people-view';
import { useSync } from '@/sync/provider';
import { leaveSharedBook, renameSharedBook, SharedBookError } from '@/sync/shared';

const ACCENT = '#0B7C4F';

/** Balances this small are rounding noise, not money owed. */
const SETTLED_EPSILON = 0.005;

/** Which slice of people is on screen. */
type Filter = 'all' | 'get' | 'pay' | 'settled' | 'archived';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'get', label: 'You’ll get' },
  { key: 'pay', label: 'You’ll pay' },
  { key: 'settled', label: 'Settled' },
  { key: 'archived', label: 'Archived' },
];

const VIEWS: { key: PeopleView; icon: React.ComponentProps<typeof MaterialIcons>['name']; label: string }[] = [
  { key: 'list', icon: 'view-agenda', label: 'List view' },
  { key: 'grid', icon: 'grid-view', label: 'Grid view' },
  { key: 'table', icon: 'table-rows', label: 'Table view' },
];

/** Fills the empty half of a grid row with an odd number of people. */
const GRID_SPACER = '__grid_spacer__';

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
  /** Stable list key — two books could carry the same display name. */
  key: string;
};

const isShared = (row: Row): boolean => !!row.bookId;

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

function matchesFilter(person: Row, filter: Filter): boolean {
  // Archived people live in their own view and nowhere else, so an archived
  // person never quietly pads the other tabs' counts.
  if (filter === 'archived') return !!person.archived;
  if (person.archived) return false;
  if (filter === 'get') return person.balance > SETTLED_EPSILON;
  if (filter === 'pay') return person.balance < -SETTLED_EPSILON;
  if (filter === 'settled') return isSettled(person);
  return true;
}

export default function PeopleScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { status } = useSync();
  const view = usePeopleView();

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
      bookId: book.id,
      pending: book.pending,
      key: `book:${book.id}`,
    }));

    return [...own, ...shared].sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned - a.pinned;
      if (a.lastDay !== b.lastDay) return a.lastDay < b.lastDay ? 1 : -1;
      return a.person.localeCompare(b.person);
    });
  }, [ownPeople, books]);

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  // The person whose options sheet is open, or null.
  const [sheetFor, setSheetFor] = useState<Row | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // The person being renamed, or deleted, and how far the delete has got:
  // stage 2 is the second warning, which only people with history ever see.
  const [renameFor, setRenameFor] = useState<Row | null>(null);
  const [deleteFor, setDeleteFor] = useState<Row | null>(null);
  const [deleteStage, setDeleteStage] = useState<1 | 2>(1);
  // Renaming or leaving a shared book talks to the server, so unlike the purely
  // local person actions it has something to report when it fails.
  const [notice, setNotice] = useState<string | null>(null);

  const query = search.trim().toLowerCase();

  const counts = useMemo(() => {
    const tally = { all: 0, get: 0, pay: 0, settled: 0, archived: 0 } as Record<Filter, number>;
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
    () => (query ? inFilter.filter((p) => p.person.toLowerCase().includes(query)) : inFilter),
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
  // — money owed through a shared book is still money owed.
  const combinedTotals = useMemo(() => {
    let { receivable, payable } = totals;
    for (const book of books) {
      if (book.archived) continue;
      if (book.balance > 0) receivable += book.balance;
      else payable += -book.balance;
    }
    return { receivable, payable };
  }, [totals, books]);

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

    try {
      renamePerson(renameFor.person, name);
    } catch (error) {
      return (error as Error).message;
    }
    setRenameFor(null);
  };

  const askDelete = (person: Row) => {
    setDeleteStage(1);
    setDeleteFor(person);
  };

  const confirmDelete = () => {
    if (!deleteFor) return;

    if (deleteFor.bookId) {
      // Leaving is the book's version of delete: your copy goes, the other
      // member keeps theirs. One confirmation is enough — nothing is destroyed.
      const bookId = deleteFor.bookId;
      setDeleteFor(null);
      leaveSharedBook(bookId, me).catch((error) =>
        setNotice(
          error instanceof SharedBookError
            ? error.message
            : 'Couldn’t leave the book. It needs a connection.'
        )
      );
      return;
    }

    // Anyone with entries or an open balance is asked a second time; everyone
    // else goes on the first Delete, since there is nothing to lose.
    if (deleteStage === 1 && needsSecondWarning(deleteFor)) {
      setDeleteStage(2);
      return;
    }
    deletePerson(deleteFor.person);
    setDeleteFor(null);
  };

  const sheetActions = (person: Row): SheetAction[] =>
    isShared(person)
      ? [
          {
            label: person.pinned ? 'Unpin from top' : 'Pin to top',
            icon: 'push-pin',
            onPress: () => setBookPinned(person.bookId!, !person.pinned),
          },
          {
            label: person.archived ? 'Unarchive' : 'Archive',
            icon: person.archived ? 'unarchive' : 'archive',
            onPress: () => setBookArchived(person.bookId!, !person.archived),
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
            // Leaving, not deleting: the other member's copy is not yours to
            // remove, so the wording has to say what actually happens.
            label: 'Leave book',
            icon: 'logout',
            destructive: true,
            onPress: () => askDelete(person),
          },
        ]
      : [
          {
            label: person.pinned ? 'Unpin from top' : 'Pin to top',
            icon: 'push-pin',
            onPress: () => setPersonPinned(person.person, !person.pinned),
          },
          {
            label: person.archived ? 'Unarchive' : 'Archive',
            icon: person.archived ? 'unarchive' : 'archive',
            onPress: () => setPersonArchived(person.person, !person.archived),
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
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
                  onPress={() => router.push('/shared-new' as Href)}
                  style={({ pressed }) => [
                    styles.addPerson,
                    { backgroundColor: theme.backgroundElement },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Create or join a shared book">
                  <MaterialIcons name="groups" size={22} color={ACCENT} />
                </Pressable>
                <Pressable
                  onPress={() => setAddOpen(true)}
                  style={({ pressed }) => [
                    styles.addPerson,
                    { backgroundColor: theme.backgroundElement },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Add a person">
                  <MaterialIcons name="person-add-alt" size={22} color={ACCENT} />
                </Pressable>
              </View>

              <View style={styles.tiles}>
                <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {filter === 'archived' ? 'Archived · you’ll get' : 'You’ll get'}
                  </ThemedText>
                  <ThemedText style={[styles.tileValue, { color: MoneyColors.in }]}>
                    {formatMoney(shownTotals.receivable)}
                  </ThemedText>
                </View>
                <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {filter === 'archived' ? 'Archived · you’ll pay' : 'You’ll pay'}
                  </ThemedText>
                  <ThemedText style={[styles.tileValue, { color: MoneyColors.out }]}>
                    {formatMoney(shownTotals.payable)}
                  </ThemedText>
                </View>
              </View>

              <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement }]}>
                <MaterialIcons name="search" size={20} color={theme.textSecondary} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search people"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="Search people"
                  style={[styles.searchInput, { color: theme.text }]}
                />
                {search.length > 0 && (
                  <Pressable
                    onPress={() => setSearch('')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search">
                    <MaterialIcons name="close" size={20} color={theme.textSecondary} />
                  </Pressable>
                )}
              </View>

              <View style={styles.controls}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chips}>
                  {FILTERS.map(({ key, label }) => {
                    // Archived only earns a chip once something is in there.
                    if (key === 'archived' && counts.archived === 0) return null;
                    const selected = key === filter;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setFilter(key)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: selected ? ACCENT : theme.backgroundElement,
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}>
                        <ThemedText
                          type="smallBold"
                          style={{ color: selected ? '#ffffff' : theme.textSecondary }}>
                          {label} {counts[key]}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <View style={[styles.viewSwitch, { backgroundColor: theme.backgroundElement }]}>
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
                          color={selected ? ACCENT : theme.textSecondary}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {query.length > 0 && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.searchMeta}>
                  {visible.length} of {inFilter.length}{' '}
                  {inFilter.length === 1 ? 'person' : 'people'}
                  {status === 'offline' ? ' · offline, searching saved data' : ''}
                </ThemedText>
              )}

              {view === 'table' && visible.length > 0 && (
                <View style={[styles.tableHead, { borderBottomColor: theme.backgroundSelected }]}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.colPerson}>
                    Person
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.colNumber}>
                    Gave
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.colNumber}>
                    Took
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.colBalance}>
                    Balance
                  </ThemedText>
                </View>
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
                ) : view === 'table' ? (
                  <PersonTableRow {...rowProps(item)} />
                ) : (
                  <PersonRow {...rowProps(item)} onMore={() => setSheetFor(item)} />
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
            />
          }
        />
      </SafeAreaView>

      <AddButton href={'/ledger' as Href} />

      <ActionSheet
        visible={sheetFor !== null}
        title={sheetFor?.person}
        actions={sheetFor ? sheetActions(sheetFor) : []}
        onClose={() => setSheetFor(null)}
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

      {/* One warning for a blank slate, two for anyone with money or history. */}
      <ConfirmModal
        visible={deleteFor !== null}
        destructive
        title={
          deleteFor?.bookId
            ? `Leave ${deleteFor.person}?`
            : deleteStage === 2
              ? `Delete ${deleteFor?.person} for good?`
              : `Delete ${deleteFor?.person}?`
        }
        message={
          !deleteFor
            ? undefined
            : deleteFor.bookId
              ? 'You’ll stop seeing this book and its entries on all your devices. The other person keeps the book and its full history.'
              : deleteStage === 2
                ? `Last check: ${deleteCost(deleteFor)} will be gone from every device, and there is no undo.`
                : needsSecondWarning(deleteFor)
                  ? `This removes ${deleteCost(deleteFor)}. Archive them instead to clear the list and keep the history.`
                  : 'They have no entries yet, so nothing else is lost.'
        }
        confirmLabel={
          deleteFor?.bookId ? 'Leave' : deleteStage === 2 ? 'Delete forever' : 'Delete'
        }
        cancelLabel={!deleteFor?.bookId && deleteStage === 2 ? 'No, keep them' : 'Cancel'}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteFor(null)}
      />

      <ConfirmModal
        visible={notice !== null}
        title={notice ?? ''}
        confirmLabel="OK"
        cancelLabel="Dismiss"
        onConfirm={() => setNotice(null)}
        onCancel={() => setNotice(null)}
      />
    </ThemedView>
  );
}

/** Marks a row as a book both people can see and write to. */
function SharedBadge() {
  return (
    <View style={[styles.badge, { backgroundColor: ACCENT }]}>
      <MaterialIcons name="groups" size={11} color="#ffffff" />
      <ThemedText style={styles.badgeText}>Shared</ThemedText>
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
    label: fresh ? 'No entries yet' : settled ? 'Settled up' : owesYou ? 'Owes you' : 'You owe',
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
  const { settled, fresh, color, label, initial } = useStanding(person);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button">
      <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText style={[styles.rowInitial, { color: settled ? theme.textSecondary : color }]}>
          {initial}
        </ThemedText>
      </View>

      <View style={styles.middle}>
        <View style={styles.nameRow}>
          {!!person.pinned && <MaterialIcons name="push-pin" size={13} color={ACCENT} />}
          <ThemedText type="smallBold" numberOfLines={1} style={styles.personName}>
            {person.person}
          </ThemedText>
          {isShared(person) && <SharedBadge />}
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {person.pending
            ? 'Waiting for them to join'
            : fresh
              ? label
              : `${label} · ${formatRelativeDay(person.lastDay)}`}
        </ThemedText>
      </View>

      <View style={styles.right}>
        <ThemedText type="smallBold" style={[styles.balanceValue, { color }]}>
          {formatMoney(Math.abs(person.balance))}
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
  const { settled, color, label, initial } = useStanding(person);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        styles.tileCard,
        { backgroundColor: theme.backgroundElement },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button">
      {!!person.pinned && (
        <MaterialIcons name="push-pin" size={13} color={ACCENT} style={styles.tilePin} />
      )}
      <View style={[styles.tileAvatar, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText style={[styles.rowInitial, { color: settled ? theme.textSecondary : color }]}>
          {initial}
        </ThemedText>
      </View>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.tileName}>
        {person.person}
      </ThemedText>
      {isShared(person) ? (
        <SharedBadge />
      ) : (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {label}
        </ThemedText>
      )}
      <ThemedText type="smallBold" style={[styles.tileAmount, { color }]}>
        {formatMoney(Math.abs(person.balance))}
      </ThemedText>
    </Pressable>
  );
}

/** Dense tabular row: what was given, what was taken, and the net. */
function PersonTableRow({ person, onPress, onLongPress }: RowProps) {
  const theme = useTheme();
  const { settled, color, initial } = useStanding(person);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        styles.tableRow,
        { borderBottomColor: theme.backgroundElement },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button">
      <View style={[styles.colPerson, styles.tablePerson]}>
        <View style={[styles.tableAvatar, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText
            type="small"
            style={{ color: settled ? theme.textSecondary : color, fontWeight: '700' }}>
            {initial}
          </ThemedText>
        </View>
        {!!person.pinned && <MaterialIcons name="push-pin" size={12} color={ACCENT} />}
        {isShared(person) && <MaterialIcons name="groups" size={13} color={ACCENT} />}
        <ThemedText type="smallBold" numberOfLines={1} style={styles.tableName}>
          {person.person}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.colNumber}>
        {formatCompact(person.gave)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.colNumber}>
        {formatCompact(person.took)}
      </ThemedText>
      <ThemedText type="smallBold" style={[styles.colBalance, { color }]}>
        {settled ? '—' : `${person.balance > 0 ? '+' : '−'}${formatCompact(person.balance)}`}
      </ThemedText>
    </Pressable>
  );
}

/** Why the list is empty depends on how you got here, so say the right thing. */
function EmptyState({
  filter,
  search,
  hasAnyone,
}: {
  filter: Filter;
  search: string;
  hasAnyone: boolean;
}) {
  const [emoji, title, hint] = search
    ? ['🔍', 'No matches', `Nobody named “${search}” in this view.`]
    : !hasAnyone
      ? ['🤝', 'No loans yet', 'Tap “＋ Add” to record a give or take, or add a person to start your list.']
      : filter === 'archived'
        ? ['🗄️', 'Nothing archived', 'Press and hold anyone to archive them. Their history is kept.']
        : filter === 'get'
          ? ['✅', 'Nobody owes you', 'Everyone you’ve lent to has paid you back.']
          : filter === 'pay'
            ? ['✅', 'You owe nobody', 'You’re all square with everyone.']
            : filter === 'settled'
              ? ['📂', 'Nobody settled yet', 'People show up here once their balance reaches zero.']
              : ['🤝', 'No people here', 'Add an entry to start tracking someone.'];

  return (
    <View style={styles.empty}>
      <ThemedText style={styles.emptyEmoji}>{emoji}</ThemedText>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
        {hint}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  header: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
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
    fontSize: 40,
    lineHeight: 46,
  },
  tiles: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  tile: {
    flex: 1,
    borderRadius: 16,
    padding: Spacing.three,
    gap: 2,
  },
  tileValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  searchInput: {
    flex: 1,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  chips: {
    gap: Spacing.two,
    paddingRight: Spacing.two,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  viewSwitch: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: Spacing.half,
    gap: Spacing.half,
  },
  viewButton: {
    width: 34,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchMeta: {
    marginTop: -Spacing.one,
    marginBottom: Spacing.two,
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
    borderRadius: 16,
    marginBottom: Spacing.two,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInitial: {
    fontSize: 20,
    fontWeight: '700',
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
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  tileCard: {
    flex: 1,
    borderRadius: 16,
    padding: Spacing.three,
    marginBottom: Spacing.two,
    gap: 2,
  },
  tilePin: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
  },
  tileAvatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  tileName: {
    fontSize: 15,
  },
  tileAmount: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: Spacing.one,
  },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tablePerson: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  tableAvatar: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableName: {
    flexShrink: 1,
  },
  colPerson: {
    flex: 1,
    minWidth: 0,
  },
  colNumber: {
    width: 56,
    textAlign: 'right',
  },
  colBalance: {
    width: 72,
    textAlign: 'right',
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
  emptyEmoji: {
    fontSize: 40,
    marginBottom: Spacing.one,
  },
  emptyHint: {
    textAlign: 'center',
  },
});
