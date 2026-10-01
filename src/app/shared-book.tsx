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
import { DayHeader } from '@/components/day-header';
import { PromptModal } from '@/components/prompt-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
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
  type SharedEntry,
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
import { useSync } from '@/sync/provider';

const SETTLED_EPSILON = 0.005;

/**
 * How long the balance waits on the server before the saved one is shown
 * anyway. A flaky connection can hang a request for far longer than this, and
 * a book that works offline shouldn't lock you out of it in the meantime.
 */
const REFRESH_TIMEOUT_MS = 12_000;

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
  const { status, refreshNow } = useSync();
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
   * those only exist here once a sync has pulled them. Until then the balance
   * is a guess, so the book opens by checking, and holds the balance and the
   * buttons back until it knows.
   */
  const [freshness, setFreshness] = useState<Freshness>('checking');
  // Whether the running check came from pull-to-refresh, which draws its own
  // spinner at the top of the list.
  const [pulled, setPulled] = useState(false);
  const latestCheck = useRef(0);
  const checking = freshness === 'checking';

  const check = useCallback(async () => {
    const run = ++latestCheck.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gaveUp = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), REFRESH_TIMEOUT_MS);
    });

    const sync = refreshNow();
    const ok = await Promise.race([sync, gaveUp]);
    clearTimeout(timer);

    // Only the newest check gets to say how fresh the screen is.
    if (run !== latestCheck.current) return;
    setFreshness(ok ? 'current' : 'saved');
    setPulled(false);

    // A slow sync can still land after we stopped waiting for it.
    if (!ok) {
      sync.then((late) => {
        if (late && run === latestCheck.current) setFreshness('current');
      });
    }
  }, [refreshNow]);

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

  const refresh = (fromPull = false) => {
    if (checking) return;
    setFreshness('checking');
    setPulled(fromPull);
    void check();
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
    if (settled || !otherId || checking) return;
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
            <ThemedText type="smallBold">Book not found</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              It may have been left or removed.
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
              <ThemedView type="backgroundElement" style={styles.balanceCard}>
                <View style={styles.liveRow}>
                  <MaterialIcons name={syncIcon} size={17} color={syncColor} />
                  <ThemedText type="small" style={{ color: syncColor }}>
                    {liveLabel}
                  </ThemedText>
                </View>
                {checking ? (
                  // The saved balance may be about to change, so it isn't
                  // shown at all rather than shown and then corrected.
                  <View style={styles.balanceLoading}>
                    <ActivityIndicator size="large" color={theme.accent} />
                    <ThemedText type="small" themeColor="textSecondary">
                      Getting the latest balance…
                    </ThemedText>
                  </View>
                ) : (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      {settled
                        ? 'All settled'
                        : owesYou
                          ? `${theirLabel} owes you`
                          : `You owe ${theirLabel}`}
                    </ThemedText>
                    <ThemedText style={[styles.balance, { color: statusColor }]}>
                      {formatMoney(Math.abs(balance))}
                    </ThemedText>
                    {/* The accounting term, same as a person's statement shows. */}
                    <ThemedText type="small" themeColor="textSecondary">
                      {settled ? '' : owesYou ? 'Receivable' : 'Payable'}
                    </ThemedText>
                  </>
                )}
              </ThemedView>

              {waiting && (
                <Pressable
                  onPress={() => setCodeOpen(true)}
                  style={({ pressed }) => [
                    styles.inviteCard,
                    { backgroundColor: theme.backgroundElement },
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

              {/* Held back while checking: an entry, and a settle-up above all,
                  should be made against the real balance, not the saved one. */}
              <View style={styles.actions}>
                <Pressable
                  onPress={() => add(me)}
                  disabled={checking}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    { backgroundColor: MoneyColors.in },
                    checking && styles.disabled,
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText style={styles.actionLabel}>＋ I paid</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => otherId && add(otherId)}
                  disabled={!otherId || checking}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    { backgroundColor: MoneyColors.out },
                    (!otherId || checking) && styles.disabled,
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText style={styles.actionLabel}>
                    {otherName ? `＋ ${otherName.split(' ')[0]} paid` : '＋ They paid'}
                  </ThemedText>
                </Pressable>
              </View>

              {!settled && otherId && (
                <Pressable
                  disabled={checking}
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
                  style={[styles.settleBtn, checking && styles.disabled]}
                  hitSlop={8}>
                  <ThemedText type="smallBold">Settle up</ThemedText>
                </Pressable>
              )}

              <ThemedText type="smallBold" style={styles.statementTitle}>
                Statement
              </ThemedText>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <DayHeader day={section.day} net={section.net} first={section === days[0]} />
          )}
          renderItem={({ item }) => (
            <EntryRow
              entry={item}
              me={me}
              otherName={otherName}
              synced={!pending.has(item.id)}
              onPress={() =>
                item.author_id === me
                  ? router.push(`/shared-entry?id=${encodeURIComponent(item.id)}` as Href)
                  : setNotice('Only the person who added an entry can change it.')
              }
            />
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
 * One line of the statement. The sign is worked out here, per viewer: the row
 * is the same on both phones, but "you paid" on one is "they paid" on the other.
 */
function EntryRow({
  entry,
  me,
  otherName,
  synced,
  onPress,
}: {
  entry: SharedEntry;
  me: string;
  otherName: string | null;
  /** False while the entry is still queued to go up. */
  synced: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const youPaid = entry.payer_id === me;
  const color = youPaid ? MoneyColors.in : MoneyColors.out;
  const who = youPaid ? 'You paid' : `${otherName ?? 'They'} paid`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.entryRow, pressed && { opacity: 0.6 }]}>
      <View style={styles.entryMiddle}>
        <View style={styles.entryWho}>
          <ThemedText type="smallBold">{who}</ThemedText>
          {/* On every entry, yours included — the useful question is "has the
              other person got this yet?", not "who typed it?". */}
          <MaterialIcons
            name={synced ? 'cloud-done' : 'cloud-upload'}
            size={13}
            color={synced ? theme.textSecondary : theme.accent}
            accessibilityLabel={synced ? 'Synced' : 'Waiting to sync'}
          />
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {/* The day is in the divider above, so an empty note shows the time. */}
          {entry.note?.trim() || formatTime(entry.created_at)}
        </ThemedText>
      </View>
      <ThemedText type="smallBold" style={{ color }}>
        {youPaid ? '+' : '−'}
        {formatMoney(entry.amount)}
      </ThemedText>
    </Pressable>
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
    paddingBottom: BottomTabInset + Spacing.four,
  },
  head: {
    gap: Spacing.three,
  },
  balanceCard: {
    borderRadius: 20,
    padding: Spacing.four,
    gap: Spacing.half,
    alignItems: 'center',
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: Spacing.one,
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
  balanceLoading: {
    // Roughly the height of the balance it stands in for, so the card
    // doesn't jump when the number arrives.
    minHeight: 94,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  balance: {
    fontSize: 44,
    fontWeight: '700',
    lineHeight: 50,
  },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 16,
    padding: Spacing.three,
  },
  inviteText: {
    flex: 1,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  actionLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.85,
  },
  settleBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  statementTitle: {
    marginTop: Spacing.one,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  entryMiddle: {
    flex: 1,
    gap: 1,
  },
  entryWho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
  emoji: {
    fontSize: 40,
    marginBottom: Spacing.one,
  },
  center: {
    textAlign: 'center',
  },
});

