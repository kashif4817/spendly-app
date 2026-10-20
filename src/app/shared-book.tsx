import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  SectionList,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/action-sheet';
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
  getSharedBalance,
  getSharedBook,
  getPendingRowIds,
  getSharedEntries,
  getSharedMemberName,
  setBookArchived,
  setBookPinned,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { formatTime, groupByDay } from '@/lib/date';
import { confirm, notify } from '@/lib/confirm';
import { formatMoney } from '@/lib/money';
import {
  leaveSharedBook,
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

  // One section per day, netted from your side: what you paid in, what they
  // paid out — the same sum the balance uses.
  const days = useMemo(
    () => groupByDay(entries, (e) => (e.payer_id === me ? e.amount : -e.amount)),
    [entries, me]
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
        <SectionList
          sections={days}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
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

              <StatementHeading />
            </View>
          }
          renderSectionHeader={({ section }) => (
            <StatementDay day={section.day} net={section.net} first={section === days[0]} />
          )}
          renderItem={({ item }) => {
            const youPaid = item.payer_id === me;
            return (
              <StatementRow
                title={youPaid ? 'You paid' : `${otherName ?? 'They'} paid`}
                // The day is in the strip above, so an empty note shows the time.
                note={item.note?.trim() || formatTime(item.created_at)}
                amount={item.amount}
                positive={youPaid}
                color={youPaid ? theme.money.in : theme.money.out}
                trailing={
                  /* Only when it hasn't gone up yet. A tick on every single row
                     told you nothing and left the page covered in badges. */
                  pending.has(item.id) ? (
                    <MaterialIcons
                      name="cloud-upload"
                      size={13}
                      color={theme.accentTint}
                      accessibilityLabel="Waiting to sync"
                    />
                  ) : undefined
                }
                onPress={() =>
                  item.author_id === me
                    ? router.push(`/shared-entry?id=${encodeURIComponent(item.id)}` as Href)
                    : setNotice('Only the person who added an entry can change it.')
                }
              />
            );
          }}
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

