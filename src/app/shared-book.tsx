import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/action-sheet';
import { ConfirmModal } from '@/components/confirm-modal';
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
  getSharedEntries,
  getSharedMemberName,
  setBookArchived,
  setBookPinned,
  type SharedEntry,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import {
  leaveSharedBook,
  renameSharedBook,
  rotateJoinCode,
  SharedBookError,
} from '@/sync/shared';
import { useSync } from '@/sync/provider';

const ACCENT = '#0B7C4F';
const SETTLED_EPSILON = 0.005;

export default function SharedBookScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { status } = useSync();
  const params = useLocalSearchParams<{ id?: string }>();
  const bookId = params.id ?? '';

  const me = getCurrentUserId() ?? '';
  const book = useQuery(() => getSharedBook(bookId), [bookId]);
  const entries = useQuery(() => getSharedEntries(bookId), [bookId]);
  const balance = useQuery(() => getSharedBalance(bookId, me), [bookId, me]);

  const flags = useQuery(() => getBookFlags(bookId), [bookId]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmSettle, setConfirmSettle] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    setConfirmLeave(false);
    try {
      await leaveSharedBook(bookId, me);
      router.back();
    } catch (e) {
      setNotice(e instanceof SharedBookError ? e.message : 'Couldn’t reach the server.');
    }
  };

  /** Settle up: whoever is behind records a payment that zeroes the balance. */
  const settleUp = () => {
    setConfirmSettle(false);
    if (settled || !otherId) return;
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
        <View style={styles.missing}>
          <ThemedText style={styles.emoji}>🗒️</ThemedText>
          <ThemedText type="smallBold">Book not found</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            It may have been left or removed.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  const waiting = !otherId;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: book.name || 'Shared book',
          headerRight: () => (
            <Pressable
              onPress={() => setMenuOpen(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Book options">
              <MaterialIcons name="more-vert" size={22} color={theme.text} />
            </Pressable>
          ),
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.head}>
              <ThemedView type="backgroundElement" style={styles.balanceCard}>
                <View style={styles.liveRow}>
                  <View
                    style={[
                      styles.liveDot,
                      { backgroundColor: status === 'offline' ? theme.textSecondary : ACCENT },
                    ]}
                  />
                  <ThemedText type="small" themeColor="textSecondary">
                    {status === 'offline' ? 'Offline · will sync' : 'Live · shared'}
                  </ThemedText>
                </View>
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
              </ThemedView>

              {waiting && (
                <Pressable
                  onPress={() => setCodeOpen(true)}
                  style={({ pressed }) => [
                    styles.inviteCard,
                    { backgroundColor: theme.backgroundElement },
                    pressed && styles.pressed,
                  ]}>
                  <MaterialIcons name="person-add" size={20} color={ACCENT} />
                  <View style={styles.inviteText}>
                    <ThemedText type="smallBold">Nobody has joined yet</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Tap to share the code {book.join_code ?? ''}
                    </ThemedText>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
                </Pressable>
              )}

              <View style={styles.actions}>
                <Pressable
                  onPress={() => add(me)}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    { backgroundColor: MoneyColors.in },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText style={styles.actionLabel}>＋ I paid</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => otherId && add(otherId)}
                  disabled={!otherId}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    { backgroundColor: MoneyColors.out },
                    !otherId && styles.disabled,
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText style={styles.actionLabel}>
                    {otherName ? `＋ ${otherName.split(' ')[0]} paid` : '＋ They paid'}
                  </ThemedText>
                </Pressable>
              </View>

              {!settled && otherId && (
                <Pressable onPress={() => setConfirmSettle(true)} style={styles.settleBtn} hitSlop={8}>
                  <ThemedText type="smallBold">Settle up</ThemedText>
                </Pressable>
              )}

              <ThemedText type="smallBold" style={styles.statementTitle}>
                Statement
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => (
            <EntryRow
              entry={item}
              me={me}
              otherName={otherName}
              onPress={() =>
                item.author_id === me
                  ? router.push(`/shared-entry?id=${encodeURIComponent(item.id)}` as Href)
                  : setNotice('Only the person who added an entry can change it.')
              }
            />
          )}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No entries yet. Use the buttons above to record who paid.
            </ThemedText>
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
            onPress: () => setConfirmLeave(true),
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

      <ConfirmModal
        visible={confirmSettle}
        title="Settle up?"
        message={`This records a payment of ${formatMoney(
          Math.abs(balance)
        )} to bring the balance to zero. ${theirLabel} will see it too.`}
        confirmLabel="Settle"
        onCancel={() => setConfirmSettle(false)}
        onConfirm={settleUp}
      />

      <ConfirmModal
        visible={confirmLeave}
        title="Leave this book?"
        message="You'll stop seeing it and its entries on all your devices. The other person keeps the book and its full history."
        confirmLabel="Leave"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={leave}
      />

      <ConfirmModal
        visible={notice !== null}
        title={notice ?? ''}
        confirmLabel="OK"
        cancelLabel="Dismiss"
        onCancel={() => setNotice(null)}
        onConfirm={() => setNotice(null)}
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
  onPress,
}: {
  entry: SharedEntry;
  me: string;
  otherName: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const youPaid = entry.payer_id === me;
  const color = youPaid ? MoneyColors.in : MoneyColors.out;
  const who = youPaid ? 'You paid' : `${otherName ?? 'They'} paid`;
  const addedByOther = entry.author_id !== me;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.entryRow, pressed && { opacity: 0.6 }]}>
      <View style={styles.entryMiddle}>
        <View style={styles.entryWho}>
          <ThemedText type="smallBold">{who}</ThemedText>
          {addedByOther && (
            <MaterialIcons name="cloud-done" size={13} color={theme.textSecondary} />
          )}
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {entry.note?.trim() || formatRelativeDay(entry.day)}
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
    borderRadius: Spacing.four,
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
