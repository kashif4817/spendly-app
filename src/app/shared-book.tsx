import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/action-sheet';
import { UnreadBadge } from '@/components/chat';
import { DragGroup, DragItem } from '@/components/drag-list';
import { GlassButton } from '@/components/glass';
import { PromptModal } from '@/components/prompt-modal';
import {
  SettleButton,
  StatementActions,
  StatementBalance,
  StatementDay,
  StatementHeading,
  StatementRow,
} from '@/components/statement';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  addSharedEntry,
  getBookFlags,
  getBookMembers,
  getCurrentUserId,
  getEditedEntryIds,
  getOpenRequests,
  getSharedBalance,
  getSharedBook,
  getPendingRowIds,
  getSharedEntries,
  getSharedMemberName,
  getUnreadCount,
  getUnseenActivityCount,
  reorderSharedDay,
  setBookArchived,
  setBookPinned,
} from '@/db';
import { AwaitingMark, EditedTag, RequestBar } from '@/components/entry-safety';
import { useQuery } from '@/db/hooks';
import { useBookMuted } from '@/hooks/use-book-muted';
import { useTheme } from '@/hooks/use-theme';
import { formatTime, groupByDay } from '@/lib/date';
import { confirm, notify } from '@/lib/confirm';
import { bookScope } from '@/lib/balance-privacy';
import { remindAboutBook } from '@/lib/balance-reminder';
import { formatMoney } from '@/lib/money';
import { setBookMuted } from '@/lib/muted-books';
import { setActiveBook } from '@/lib/notifications';
import { shareBookBalance } from '@/lib/share-balance';
import {
  leaveSharedBook,
  pushEntryOrder,
  renameSharedBook,
  rotateJoinCode,
  SharedBookError,
} from '@/sync/shared';
import { isRealtimeLive } from '@/sync/realtime';
import { useSync } from '@/sync/provider';

const SETTLED_EPSILON = 0.005;

/**
 * How long to keep saying "checking" before admitting the saved balance is
 * all we have. The balance itself is on screen the whole time, so this only
 * governs the wording — it no longer gates the book.
 */
const REFRESH_TIMEOUT_MS = 6_000;

/**
 * How recently a sync must have finished for a live socket to count as proof
 * the book is current.
 *
 * Realtime delivers the other phone's entries as they happen, so once it is
 * subscribed AND a pull has run since, a fetch on open would ask the server
 * for rows it has already sent us. Opening the book then costs nothing.
 */
const FRESH_WINDOW_MS = 60_000;

/**
 * How far the balance on screen can be trusted:
 *   checking — a sync is running, so the balance may be about to change
 *   current  — the sync finished; this is what the server has
 *   saved    — the server couldn't be reached; this is the last saved copy
 */
type Freshness = 'checking' | 'current' | 'saved';

export default function SharedBookScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { status, refreshShared, lastSyncedAt } = useSync();
  const params = useLocalSearchParams<{ id?: string }>();
  const bookId = params.id ?? '';
  // Keyed by id, not name: a book can be renamed and stay the same book.
  const scope = bookScope(bookId);
  const muted = useBookMuted(bookId);

  // While this book is on screen, the other member's changes to it show up
  // right here — so the notification handler keeps their banners quiet.
  useFocusEffect(
    useCallback(() => {
      setActiveBook(bookId);
      return () => setActiveBook(null);
    }, [bookId])
  );

  const me = getCurrentUserId() ?? '';
  const book = useQuery(() => getSharedBook(bookId), [bookId]);
  const entries = useQuery(() => getSharedEntries(bookId), [bookId]);
  const balance = useQuery(() => getSharedBalance(bookId, me), [bookId, me]);
  /**
   * Entries still queued for upload. The outbox lives in the same database, so
   * this re-runs when the push drains it and the pending mark clears itself.
   * Anything that arrived from the other phone was never in our outbox, so it
   * reads as synced — which is why their entries already looked right.
   */
  const pending = useQuery(() => new Set(getPendingRowIds('shared_entries')));
  const hasPendingChanges = entries.some((entry) => pending.has(entry.id));

  const flags = useQuery(() => getBookFlags(bookId), [bookId]);
  /**
   * Messages from the other member you haven't read. Drives the count on the
   * chat button, and clears itself when the thread is opened — the marker it
   * reads lives in the same database, so this re-runs on its own.
   */
  const unread = useQuery(() => getUnreadCount(bookId, me), [bookId, me]);

  /**
   * The safety layer (supabase/entry-safety.sql): which entries were changed
   * after they were added, change requests still waiting for an answer, and
   * how much of the activity log you haven't looked at yet.
   */
  const edited = useQuery(() => getEditedEntryIds(bookId), [bookId]);
  const openRequests = useQuery(
    () => getOpenRequests().filter((r) => r.book_id === bookId),
    [bookId]
  );
  const awaitingIds = useMemo(() => new Set(openRequests.map((r) => r.entry_id)), [openRequests]);
  const unseenActivity = useQuery(() => getUnseenActivityCount(bookId, me), [bookId, me]);
  const openActivity = () =>
    router.push(`/shared-activity?book=${encodeURIComponent(bookId)}` as Href);

  /**
   * One group per day, netted from your side: what you paid in, what they paid
   * out — the same sum the balance uses. `ids` rides along for reordering.
   */
  const days = useMemo(
    () =>
      groupByDay(entries, (e) => (e.payer_id === me ? e.amount : -e.amount)).map((group) => ({
        ...group,
        ids: group.data.map((e) => e.id),
      })),
    [entries, me]
  );

  const reorderable = days.some((group) => group.ids.length > 1);
  /** A row is in the air — the list mustn't scroll out from under it. */
  const [dragging, setDragging] = useState(false);

  /**
   * Arrange one day by hand, both members' entries alike.
   *
   * Written locally first so the list is right whatever the network is doing,
   * then handed to the server. Your own rows also go through the outbox, so
   * reordering offline still reaches your other devices — see
   * `reorderSharedDay` for why the two roads exist.
   */
  const reorderDay = useCallback(
    (day: string, ids: string[]) => {
      reorderSharedDay(bookId, day, ids);
      void pushEntryOrder(bookId, ids);
    },
    [bookId]
  );

  /**
   * The other member may have added entries while this phone was offline, and
   * those only exist here once a sync has pulled them.
   *
   * The book no longer waits on that. The saved balance is right far more
   * often than not, it is the only balance that exists offline, and hiding it
   * behind a spinner made every visit feel like a page load. It is shown
   * straight away and corrected if the pull disagrees; only Settle up, which
   * turns the balance into an actual payment, waits for a confirmed one.
   */
  const [freshness, setFreshness] = useState<Freshness>('checking');
  // Whether the running check came from pull-to-refresh, which draws its own
  // spinner at the top of the list.
  const [pulled, setPulled] = useState(false);
  const latestCheck = useRef(0);
  const checking = freshness === 'checking';

  // Read inside `check` without making it a dependency: `lastSyncedAt` is a new
  // Date on every cycle, and rebuilding `check` would re-fire the effect below
  // on each one — a sync triggering a sync.
  const lastSyncedRef = useRef(lastSyncedAt);
  useEffect(() => {
    lastSyncedRef.current = lastSyncedAt;
  }, [lastSyncedAt]);

  const check = useCallback(
    async (force = false) => {
      const run = ++latestCheck.current;

      // The socket is live and a pull has run since it came up, so the other
      // phone's entries are already here. Nothing to fetch.
      const syncedAt = lastSyncedRef.current;
      if (
        !force &&
        isRealtimeLive() &&
        syncedAt &&
        Date.now() - syncedAt.getTime() < FRESH_WINDOW_MS
      ) {
        setFreshness('current');
        setPulled(false);
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const gaveUp = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), REFRESH_TIMEOUT_MS);
      });

      // Only the shared tables: categories and expenses have no bearing on
      // what two people owe each other, and waiting on them is what made
      // opening a book take as long as it did.
      const sync = refreshShared(force);
      const ok = await Promise.race([sync, gaveUp]);
      clearTimeout(timer);

      // Only the newest check gets to say how fresh the screen is.
      if (run !== latestCheck.current) return;
      setFreshness(ok ? 'current' : 'saved');
      setPulled(false);

      // A slow sync can still land after we stopped waiting for it.
      if (!ok) {
        void sync.then((late) => {
          if (late && run === latestCheck.current) setFreshness('current');
        });
      }
    },
    [refreshShared]
  );

  useEffect(() => {
    void check();
  }, [check]);

  // Coming back to the app with the book already open is the same situation
  // as opening it: whatever changed meanwhile hasn't been pulled yet.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setFreshness('checking');
      void check();
    });
    return () => sub.remove();
  }, [check]);

  /** Pull-to-refresh and the header button: always a real round trip. */
  const refresh = (fromPull = false) => {
    if (checking) return;
    setFreshness('checking');
    setPulled(fromPull);
    void check(true);
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const setNotice = (message: string) => notify(message);

  // Who the other person is. Taken from the membership rows, not from the
  // entries — someone who has joined but not yet added anything is still very
  // much in the book. Names come from the local profile cache, so this reads
  // correctly offline too.
  const members = useQuery(() => getBookMembers(bookId), [bookId]);
  const otherId = members.find((m) => m.user_id !== me)?.user_id ?? null;
  const otherName = otherId ? getSharedMemberName(otherId) : null;
  const theirLabel = otherName ?? 'They';

  const settled = Math.abs(balance) < SETTLED_EPSILON;
  const owesYou = balance > 0;
  const statusColor = settled ? theme.textSecondary : owesYou ? MoneyColors.in : MoneyColors.out;

  const add = (payerId: string) =>
    router.push(
      `/shared-entry?book=${encodeURIComponent(bookId)}&payer=${encodeURIComponent(payerId)}` as Href
    );

  const shareCode = async () => {
    if (!book?.join_code) return;
    try {
      await Share.share({
        message: `Join my Spendly shared book with this code: ${book.join_code}`,
      });
    } catch {
      // The user dismissed the share sheet — nothing to report.
    }
  };

  const rename = (name: string): string | void => {
    if (!name.trim()) return 'Enter a name.';
    setRenameOpen(false);
    renameSharedBook(bookId, name).catch((e) =>
      setNotice(e instanceof SharedBookError ? e.message : 'Couldn’t reach the server.')
    );
  };

  const rotate = async () => {
    try {
      await rotateJoinCode(bookId);
      setNotice('New code created. The old one no longer works.');
    } catch (e) {
      setNotice(e instanceof SharedBookError ? e.message : 'Couldn’t reach the server.');
    }
  };

  const leave = async () => {
    try {
      await leaveSharedBook(bookId, me);
      router.back();
    } catch (e) {
      setNotice(e instanceof SharedBookError ? e.message : 'Couldn’t reach the server.');
    }
  };

  /** Settle up: whoever is behind records a payment that zeroes the balance. */
  const settleUp = () => {
    // The one action whose AMOUNT is the balance, so it is the one action that
    // genuinely needs a confirmed one. Adding an entry only ever appends.
    if (settled || !otherId || freshness !== 'current') return;
    // If they owe you, the settling payment comes from them.
    addSharedEntry({
      bookId,
      payerId: owesYou ? otherId : me,
      amount: Math.abs(balance),
      note: 'Settled up',
    });
  };

  if (!book) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Shared book' }} />
        {/* A book this phone hasn't pulled yet isn't missing — it's on its way. */}
        {checking ? (
          <View style={styles.missing}>
            <ActivityIndicator size="large" color={theme.accent} />
            <ThemedText type="small" themeColor="textSecondary">
              Loading the book…
            </ThemedText>
          </View>
        ) : (
          <View style={styles.missing}>
            <ThemedText type="smallBold">
              {freshness === 'saved' ? 'Not on this phone yet' : 'Book not found'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              {/* The screen no longer waits on the network, so it can reach
                  here offline — where "removed" would simply be wrong. */}
              {freshness === 'saved'
                ? 'It needs a connection the first time. Try again once you’re back online.'
                : 'It may have been left or removed.'}
            </ThemedText>
          </View>
        )}
      </ThemedView>
    );
  }

  const waiting = !otherId;

  const liveLabel = checking
    ? 'Checking for shared updates…'
    : hasPendingChanges
      ? status === 'offline'
        ? 'Saved here · waiting for a connection'
        : status === 'syncing'
          ? 'Sending your changes…'
          : 'Changes waiting to sync'
      : freshness === 'saved'
        ? status === 'offline'
          ? 'Offline · showing the saved book'
          : 'Couldn’t update · showing the saved book'
        : status === 'syncing'
          ? 'Checking for shared updates…'
          : status === 'offline'
          ? 'Offline · showing the saved book'
          : 'Up to date with the shared book';
  const syncIcon: keyof typeof MaterialIcons.glyphMap = checking || status === 'syncing'
    ? 'sync'
    : hasPendingChanges
      ? status === 'offline' ? 'cloud-off' : 'cloud-upload'
      : freshness === 'saved' || status === 'offline'
        ? 'cloud-off'
        : 'cloud-done';
  const syncColor =
    freshness === 'current' && status !== 'offline' && !hasPendingChanges
      ? theme.accent
      : theme.textSecondary;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: book.name || 'Shared book',
          headerRight: () => (
            <View style={styles.headerActions}>
              {/* Beside Refresh, and before it: the thread is the one thing
                  here you might open without having come to check a balance. */}
              <Pressable
                onPress={() =>
                  router.push(`/shared-chat?book=${encodeURIComponent(bookId)}` as Href)
                }
                hitSlop={10}
                style={styles.headerChat}
                accessibilityRole="button"
                accessibilityLabel={
                  unread > 0
                    ? `Chat, ${unread} unread ${unread === 1 ? 'message' : 'messages'}`
                    : 'Chat'
                }>
                <MaterialIcons name="chat-bubble-outline" size={22} color={theme.text} />
                <UnreadBadge count={unread} style={styles.headerBadge} />
              </Pressable>
              {/* Activity sits beside the chat: both are "what the other
                  person did", and both carry a count of what's new. */}
              <Pressable
                onPress={openActivity}
                hitSlop={10}
                style={styles.headerChat}
                accessibilityRole="button"
                accessibilityLabel={
                  unseenActivity > 0
                    ? `Activity, ${unseenActivity} new ${unseenActivity === 1 ? 'change' : 'changes'}`
                    : 'Activity'
                }>
                <MaterialIcons name="history" size={23} color={theme.text} />
                <UnreadBadge count={unseenActivity} style={styles.headerBadge} />
              </Pressable>
              <Pressable
                onPress={() => refresh()}
                disabled={checking}
                hitSlop={10}
                style={[styles.headerIcon, checking && styles.disabled]}
                accessibilityRole="button"
                accessibilityLabel="Refresh"
                accessibilityState={{ disabled: checking, busy: checking }}>
                <MaterialIcons name="refresh" size={22} color={theme.text} />
              </Pressable>
              <Pressable
                onPress={() => setMenuOpen(true)}
                hitSlop={10}
                style={styles.headerIcon}
                accessibilityRole="button"
                accessibilityLabel="Book options">
                <MaterialIcons name="more-vert" size={22} color={theme.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        {/* A list of DAYS, not of entries: a day's rows have to be siblings
            in one view for the one being dragged to lift above the others.
            See components/drag-list.tsx. */}
        <FlatList
          data={days}
          keyExtractor={(group) => group.day}
          scrollEnabled={!dragging}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={pulled && checking}
              onRefresh={() => refresh(true)}
              tintColor={theme.accent}
              colors={[theme.accent]}
            />
          }
          ListHeaderComponent={
            <View style={styles.head}>
              <StatementBalance
                scope={scope}
                caption={
                  settled ? 'All settled' : owesYou ? `${theirLabel} owes you` : `You owe ${theirLabel}`
                }
                amount={balance}
                term={settled ? null : owesYou ? 'Receivable' : 'Payable'}
                color={statusColor}
                status={
                  /* The balance is always on screen — it is the only one that
                     exists offline, and it is right far more often than not.
                     This chip says how much to trust it. */
                  <View style={[styles.liveRow, theme.glassWeak]}>
                    {checking ? (
                      <ActivityIndicator size="small" color={syncColor} />
                    ) : (
                      <MaterialIcons name={syncIcon} size={15} color={syncColor} />
                    )}
                    <ThemedText type="small" style={{ color: syncColor }}>
                      {liveLabel}
                    </ThemedText>
                  </View>
                }
              />

              {waiting && (
                <Pressable
                  onPress={() => setCodeOpen(true)}
                  style={({ pressed }) => [
                    styles.inviteCard,
                    theme.glass,
                    pressed && styles.pressed,
                  ]}>
                  <MaterialIcons name="person-add" size={20} color={theme.accent} />
                  <View style={styles.inviteText}>
                    <ThemedText type="smallBold">Nobody has joined yet</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Tap to share the code {book.join_code ?? ''}
                    </ThemedText>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
                </Pressable>
              )}

              {/* A change request stays here until it's answered — the pop-up
                  that announced it closes after a minute, this doesn't. */}
              {openRequests.map((request) => (
                <RequestBar
                  key={request.id}
                  request={request}
                  me={me}
                  onPress={() =>
                    router.push(`/entry-request?id=${encodeURIComponent(request.id)}` as Href)
                  }
                />
              ))}

              {/* Recording who paid only ever APPENDS a row, so it never
                  needed the balance to be confirmed first. Waiting on a sync
                  to enable these is what made the book feel slow. */}
              <StatementActions>
                <ActionButton label="I paid" tone="in" onPress={() => add(me)} />
                <ActionButton
                  label={otherName ? `${otherName.split(' ')[0]} paid` : 'They paid'}
                  tone="out"
                  disabled={!otherId}
                  onPress={() => otherId && add(otherId)}
                />
              </StatementActions>

              {!settled && otherId && (
                <SettleButton
                  // Settling turns the balance into a real payment, so this is
                  // the one control that waits for a balance we've confirmed.
                  disabled={freshness !== 'current'}
                  label={checking ? 'Settle up — checking balance…' : 'Settle up'}
                  onPress={() =>
                    confirm({
                      title: 'Settle up?',
                      message: `This records a payment of ${formatMoney(
                        Math.abs(balance)
                      )} to bring the balance to zero. ${theirLabel} will see it too.`,
                      confirmLabel: 'Settle',
                      onConfirm: settleUp,
                    })
                  }
                />
              )}

              <StatementHeading hint={reorderable ? 'Hold a row to reorder' : undefined} />
            </View>
          }
          renderItem={({ item: group, index: dayIndex }) => (
            <View>
              <StatementDay day={group.day} net={group.net} first={dayIndex === 0} />
              {/* Either member may arrange a day, and the whole day moves —
                  including rows the other person wrote. Only the AMOUNTS are
                  the author's to change. */}
              <DragGroup
                ids={group.ids}
                onDragChange={setDragging}
                onReorder={(ids) => reorderDay(group.day, ids)}>
                {group.data.map((item, index) => {
                  const youPaid = item.payer_id === me;
                  return (
                    <DragItem key={item.id} index={index}>
                      <StatementRow
                        title={youPaid ? 'You paid' : `${otherName ?? 'They'} paid`}
                        // The day is in the strip above, so an empty note
                        // shows the time.
                        note={item.note?.trim() || formatTime(item.created_at)}
                        amount={item.amount}
                        positive={youPaid}
                        color={youPaid ? theme.money.in : theme.money.out}
                        trailing={
                          /* The sync mark only when it hasn't gone up yet — a
                             tick on every single row told you nothing and left
                             the page covered in badges. "Edited" and the
                             hourglass are the record: both phones show them. */
                          pending.has(item.id) || edited.has(item.id) || awaitingIds.has(item.id) ? (
                            <View style={styles.rowMarks}>
                              {edited.has(item.id) && <EditedTag />}
                              {awaitingIds.has(item.id) && <AwaitingMark />}
                              {pending.has(item.id) && (
                                <MaterialIcons
                                  name="cloud-upload"
                                  size={13}
                                  color={theme.accentTint}
                                  accessibilityLabel="Waiting to sync"
                                />
                              )}
                            </View>
                          ) : undefined
                        }
                        // Either member can open any entry: the author to
                        // change it, both to read its history.
                        onPress={() =>
                          router.push(`/shared-entry?id=${encodeURIComponent(item.id)}` as Href)
                        }
                      />
                    </DragItem>
                  );
                })}
              </DragGroup>
            </View>
          )}
          ListEmptyComponent={
            // Not "no entries" while the other phone's entries may still be on
            // their way down.
            checking ? null : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                No entries yet. Use the buttons above to record who paid.
              </ThemedText>
            )
          }
        />
      </SafeAreaView>

      <ActionSheet
        visible={menuOpen}
        title={book.name || 'Shared book'}
        actions={[
          {
            // In the sheet rather than the header: chat, activity, refresh and
            // options already fill that row, and a fifth icon would start
            // eating the book's name on a narrow phone.
            label: 'Share balance',
            icon: 'share',
            onPress: () => void shareBookBalance(bookId),
          },
          {
            // A notification on their phone ("… sent a balance reminder"),
            // nothing in the chat. See lib/balance-reminder.ts.
            label: 'Send a balance reminder',
            icon: 'notifications-active',
            onPress: () => remindAboutBook({ bookId, theirName: otherName, balance }),
          },
          {
            // Everything from this book on this phone: chat, reminders,
            // reactions, entries and joins. The per-kind switches live in
            // Settings → Notifications.
            label: muted ? 'Unmute notifications' : 'Mute notifications',
            icon: muted ? 'notifications' : 'notifications-off',
            onPress: () => setBookMuted(bookId, !muted),
          },
          {
            label: flags.pinned ? 'Unpin from top' : 'Pin to top',
            icon: 'push-pin',
            onPress: () => setBookPinned(bookId, !flags.pinned),
          },
          {
            label: flags.archived ? 'Unarchive' : 'Archive',
            icon: flags.archived ? 'unarchive' : 'archive',
            onPress: () => setBookArchived(bookId, !flags.archived),
          },
          { label: 'Rename', icon: 'edit', onPress: () => setRenameOpen(true) },
          { label: 'Show join code', icon: 'qr-code', onPress: () => setCodeOpen(true) },
          {
            label: 'Leave book',
            icon: 'logout',
            destructive: true,
            onPress: () =>
              confirm({
                title: 'Leave this book?',
                message:
                  'You\u2019ll stop seeing it and its entries on all your devices. The other person keeps the book and its full history.',
                confirmLabel: 'Leave',
                destructive: true,
                onConfirm: leave,
              }),
          },
        ]}
        onClose={() => setMenuOpen(false)}
      />

      <ActionSheet
        visible={codeOpen}
        title={book.join_code ? `Code: ${book.join_code}` : 'No code'}
        actions={[
          { label: 'Share code', icon: 'share', onPress: shareCode },
          { label: 'Create a new code', icon: 'autorenew', onPress: rotate },
        ]}
        onClose={() => setCodeOpen(false)}
      />

      <PromptModal
        visible={renameOpen}
        title="Rename book"
        message="Both of you will see the new name."
        initialValue={book.name}
        placeholder="Name"
        confirmLabel="Rename"
        onSubmit={rename}
        onCancel={() => setRenameOpen(false)}
      />
    </ThemedView>
  );
}

/**
 * One of the two "who paid" buttons.
 *
 * Tinted rather than filled: these sit directly under the balance, and two
 * solid blocks of green and red drowned out the number they exist to change.
 */
function ActionButton({
  label,
  tone,
  disabled,
  onPress,
}: {
  label: string;
  tone: 'in' | 'out';
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <GlassButton
      label={label}
      // The same signs the statement rows below use: what you put in reads as
      // a plus, what they put in as a minus.
      icon={tone === 'in' ? 'add' : 'remove'}
      variant="solid"
      tint={theme.moneyButton[tone]}
      disabled={disabled}
      onPress={onPress}
      style={styles.actionBtn}
    />
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
    paddingTop: Spacing.three,
    // A pushed screen, not a tab — there is no tab bar down there to clear.
    paddingBottom: Spacing.six,
  },
  head: {
    gap: Spacing.three,
  },
  // A chip rather than a line of text: it reads as a status attached to the
  // balance below it, not as a heading for the card.
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    marginBottom: Spacing.two,
    minHeight: 28,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headerIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The chat button's box, wider and taller than the other two because it is
   * the only one carrying a badge.
   *
   * The badge used to hang outside a 24pt box on negative offsets, and Android
   * clips a child that overflows its parent inside a header — which took the
   * top off the count. Everything now sits within these bounds, so there is
   * nothing left to clip.
   */
  headerChat: {
    width: 34,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Inside the box above, overlapping the icon's top-right corner — which is
  // where a count belongs, and now costs nothing to draw.
  headerBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  inviteText: {
    flex: 1,
    gap: 2,
  },
  // Beside an entry's title: "Edited", the request hourglass, the sync mark.
  rowMarks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  // GlassButton brings the shape; this only shares the row evenly.
  actionBtn: {
    flex: 1,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.85,
  },
  empty: {
    paddingVertical: Spacing.five,
    textAlign: 'center',
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
  center: {
    textAlign: 'center',
  },
});

