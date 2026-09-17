import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/action-sheet';
import { ConfirmModal } from '@/components/confirm-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  addLedgerEntry,
  getPersonBalance,
  getPersonEntries,
  getPersonFlags,
  setPersonArchived,
  setPersonPinned,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay } from '@/lib/date';
import { formatMoney } from '@/lib/money';

export default function PersonScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ person?: string }>();
  const person = params.person ?? '';

  const entries = useQuery(() => getPersonEntries(person), [person]);
  const balance = useQuery(() => getPersonBalance(person), [person]);
  const flags = useQuery(() => getPersonFlags(person), [person]);
  const [confirmSettle, setConfirmSettle] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const settled = Math.abs(balance) < 0.005;
  const owesYou = balance > 0;
  const statusColor = settled ? theme.textSecondary : owesYou ? MoneyColors.in : MoneyColors.out;

  const add = (direction: 'gave' | 'took') =>
    router.push(`/ledger?person=${encodeURIComponent(person)}&direction=${direction}` as Href);

  const settleUp = () => {
    setConfirmSettle(false);
    if (settled) return;
    addLedgerEntry({
      person,
      direction: owesYou ? 'took' : 'gave',
      amount: Math.abs(balance),
      note: 'Settled up',
    });
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: person || 'Person',
          headerRight: () => (
            <Pressable
              onPress={() => setMenuOpen(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Options for ${person}`}>
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
                <ThemedText type="small" themeColor="textSecondary">
                  {settled ? 'All settled' : owesYou ? `${person} owes you` : `You owe ${person}`}
                </ThemedText>
                <ThemedText style={[styles.balance, { color: statusColor }]}>
                  {formatMoney(Math.abs(balance))}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {owesYou ? 'Receivable' : settled ? '' : 'Payable'}
                </ThemedText>
              </ThemedView>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => add('gave')}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    { backgroundColor: MoneyColors.in },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText style={styles.actionLabel}>＋ You gave</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => add('took')}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    { backgroundColor: MoneyColors.out },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText style={styles.actionLabel}>− You took</ThemedText>
                </Pressable>
              </View>

              {!settled && (
                <Pressable onPress={() => setConfirmSettle(true)} style={styles.settleBtn} hitSlop={8}>
                  <ThemedText type="smallBold" style={{ color: theme.text }}>
                    Settle up
                  </ThemedText>
                </Pressable>
              )}

              <ThemedText type="smallBold" style={styles.statementTitle}>
                Statement
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => {
            const gave = item.direction === 'gave';
            const color = gave ? MoneyColors.in : MoneyColors.out;
            return (
              <Pressable
                onPress={() => router.push(`/ledger?id=${item.id}` as Href)}
                style={({ pressed }) => [styles.entryRow, pressed && { opacity: 0.6 }]}>
                <View style={styles.entryMiddle}>
                  <ThemedText type="smallBold">{gave ? 'You gave' : 'You took'}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.note?.trim() || formatRelativeDay(item.day)}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold" style={{ color }}>
                  {gave ? '+' : '−'}
                  {formatMoney(item.amount)}
                </ThemedText>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No entries yet. Use the buttons above to record a give or take.
            </ThemedText>
          }
        />
      </SafeAreaView>

      <ActionSheet
        visible={menuOpen}
        title={person}
        actions={[
          {
            label: flags.pinned ? 'Unpin from top' : 'Pin to top',
            icon: 'push-pin',
            onPress: () => setPersonPinned(person, !flags.pinned),
          },
          {
            label: flags.archived ? 'Unarchive' : 'Archive',
            icon: flags.archived ? 'unarchive' : 'archive',
            onPress: () => setPersonArchived(person, !flags.archived),
          },
        ]}
        onClose={() => setMenuOpen(false)}
      />

      <ConfirmModal
        visible={confirmSettle}
        title="Settle up?"
        message={`This adds a ${owesYou ? 'received' : 'paid'} entry of ${formatMoney(
          Math.abs(balance)
        )} to bring ${person}’s balance to zero.`}
        confirmLabel="Settle"
        onCancel={() => setConfirmSettle(false)}
        onConfirm={settleUp}
      />
    </ThemedView>
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
  balance: {
    fontSize: 44,
    fontWeight: '700',
    lineHeight: 50,
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
  empty: {
    paddingVertical: Spacing.five,
    textAlign: 'center',
  },
});
