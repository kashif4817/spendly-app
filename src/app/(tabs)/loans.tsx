import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { AddButton } from '@/components/add-button';
import { GlassChip } from '@/components/glass';
import { PromptModal } from '@/components/prompt-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  combineLedgerTotals,
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
import { confirm, notify } from '@/lib/confirm';
import { formatMoney } from '@/lib/money';
import { setPeopleView, type PeopleView } from '@/lib/people-view';
import { useSync } from '@/sync/provider';
import { leaveSharedBook, renameSharedBook, SharedBookError } from '@/sync/shared';

/** Balances this small are rounding noise, not money owed. */
const SETTLED_EPSILON = 0.005;

/** Which slice of people is on screen. */
type Filter = 'all' | 'archived' | 'people' | 'shared' | 'get' | 'pay' | 'settled';

// Archived sits right after All so it's in view without scrolling the row.
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'archived', label: 'Archived' },
  { key: 'people', label: 'People' },
  { key: 'shared', label: 'Shared books' },
  { key: 'get', label: 'You’ll get' },
  { key: 'pay', label: 'You’ll pay' },
  { key: 'settled', label: 'Settled' },
];

const VIEWS: { key: PeopleView; icon: React.ComponentProps<typeof MaterialIcons>['name']; label: string }[] = [
  { key: 'list', icon: 'view-agenda', label: 'List view' },
  { key: 'grid', icon: 'grid-view', label: 'Grid view' },
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
  if (filter === 'people') return !isShared(person) && !person.archived;
  if (filter === 'shared') return isShared(person) && !person.archived;
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
  // Renaming or leaving a shared book talks to the server, so unlike the purely
  // local person actions it has something to report when it fails.
  const setNotice = (message: string) => notify(message);

  const query = search.trim().toLowerCase();

  const counts = useMemo(() => {
    const tally = { all: 0, archived: 0, people: 0, shared: 0, get: 0, pay: 0, settled: 0 } as Record<Filter, number>;
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

              <View style={styles.tiles}>
                <View style={[styles.tile, theme.glass]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {filter === 'archived' ? 'Archived · you’ll get' : 'You’ll get'}
                  </ThemedText>
                  <ThemedText style={[styles.tileValue, { color: MoneyColors.in }]}>
                    {formatMoney(shownTotals.receivable)}
                  </ThemedText>
                </View>
                <View style={[styles.tile, theme.glass]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {filter === 'archived' ? 'Archived · you’ll pay' : 'You’ll pay'}
                  </ThemedText>
                  <ThemedText style={[styles.tileValue, { color: MoneyColors.out }]}>
                    {formatMoney(shownTotals.payable)}
                  </ThemedText>
                </View>
              </View>

              <View style={styles.searchRow}>
                <View style={[styles.searchBar, theme.glass]}>
                  <MaterialIcons name="search" size={20} color={theme.textSecondary} />
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
                      <MaterialIcons name="close" size={20} color={theme.textSecondary} />
                    </Pressable>
                  )}
                </View>

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
                          size={20}
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
              onAddPerson={() => setAddOpen(true)}
              onAddShared={() => router.push('/shared-new' as Href)}
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
}: {
  initial: string;
  color: string;
  size: number;
  shared: boolean;
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
  const { settled, fresh, color, label, initial } = useStanding(person);
  const shared = isShared(person);

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
      accessibilityLabel={`${person.person}${shared ? ', shared book' : ''}. ${label}.`}>
      <Avatar
        initial={initial}
        color={settled ? theme.textSecondary : color}
        size={46}
        shared={shared}
      />

      <View style={styles.middle}>
        {/* The name now has the whole row to itself. */}
        <View style={styles.nameRow}>
          {!!person.pinned && <MaterialIcons name="push-pin" size={14} color={theme.accentTint} />}
          <ThemedText type="smallBold" numberOfLines={1} style={styles.personName}>
            {person.person}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {fresh || person.pending ? label : `${label} · ${formatRelativeDay(person.lastDay)}`}
        </ThemedText>
      </View>

      <View style={styles.right}>
        <ThemedText type="smallBold" style={[styles.balanceValue, { color }]} numberOfLines={1}>
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
      />
      <ThemedText type="smallBold" numberOfLines={1} style={styles.tileName}>
        {person.person}
      </ThemedText>
      {/* Every tile says which way the money goes, shared or not. */}
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.tileLabel}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={[styles.tileAmount, { color }]} numberOfLines={1}>
        {formatMoney(Math.abs(person.balance))}
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
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
  },
  tiles: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  tile: {
    flex: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: 2,
  },
  tileValue: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
  },
  searchInput: {
    flex: 1,
    paddingVertical: Spacing.three,
    fontSize: 15,
  },
  chipRow: {
    // Bleed to the screen edges so chips scroll out of view rather than
    // being cut off at the content padding.
    marginHorizontal: -Spacing.four,
    marginBottom: Spacing.two,
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
    alignItems: 'stretch',
    borderRadius: Radius.medium,
    padding: Spacing.one,
    gap: Spacing.half,
  },
  viewButton: {
    width: 40,
    borderRadius: 8,
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
    borderRadius: Radius.card,
    marginBottom: Spacing.two,
  },
  avatar: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontWeight: '700',
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


