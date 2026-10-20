import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/action-sheet';
import { GlassButton } from '@/components/glass';
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
import { MaxContentWidth, Spacing } from '@/constants/theme';
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
import { formatTime, groupByDay } from '@/lib/date';
import { confirm } from '@/lib/confirm';
import { formatMoney } from '@/lib/money';

const SETTLED_EPSILON = 0.005;

export default function PersonScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ person?: string }>();
  const person = params.person ?? '';

  const entries = useQuery(() => getPersonEntries(person), [person]);
  const balance = useQuery(() => getPersonBalance(person), [person]);
  const flags = useQuery(() => getPersonFlags(person), [person]);
  const [menuOpen, setMenuOpen] = useState(false);

  // One section per day, netted the same way as the balance: gave in, took out.
  const days = useMemo(
    () => groupByDay(entries, (e) => (e.direction === 'gave' ? e.amount : -e.amount)),
    [entries]
  );

  const settled = Math.abs(balance) < SETTLED_EPSILON;
  const owesYou = balance > 0;
  const statusColor = settled ? theme.textSecondary : owesYou ? theme.money.in : theme.money.out;

  const add = (direction: 'gave' | 'took') =>
    router.push(`/ledger?person=${encodeURIComponent(person)}&direction=${direction}` as Href);

  const settleUp = () => {
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
        <SectionList
          sections={days}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View style={styles.head}>
              <StatementBalance
                caption={settled ? 'All settled' : owesYou ? `${person} owes you` : `You owe ${person}`}
                amount={balance}
                term={settled ? null : owesYou ? 'Receivable' : 'Payable'}
                color={statusColor}
              />

              <StatementActions>
                <GlassButton
                  label="You gave"
                  icon="add"
                  variant="solid"
                  tint={theme.moneyButton.in}
                  onPress={() => add('gave')}
                  style={styles.action}
                />
                <GlassButton
                  label="You took"
                  icon="remove"
                  variant="solid"
                  tint={theme.moneyButton.out}
                  onPress={() => add('took')}
                  style={styles.action}
                />
              </StatementActions>

              {!settled && (
                <SettleButton
                  onPress={() =>
                    confirm({
                      title: 'Settle up?',
                      message: `This adds a ${owesYou ? 'received' : 'paid'} entry of ${formatMoney(
                        Math.abs(balance)
                      )} to bring ${person}’s balance to zero.`,
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
            const gave = item.direction === 'gave';
            return (
              <StatementRow
                title={gave ? 'You gave' : 'You took'}
                // The day is in the strip above, so an empty note shows the time.
                note={item.note?.trim() || formatTime(item.created_at)}
                amount={item.amount}
                positive={gave}
                color={gave ? theme.money.in : theme.money.out}
                onPress={() => router.push(`/ledger?id=${item.id}` as Href)}
              />
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
    // A pushed screen, not a tab: no bar down there to clear.
    paddingBottom: Spacing.six,
  },
  head: {
    gap: Spacing.three,
  },
  action: {
    flex: 1,
  },
  empty: {
    paddingVertical: Spacing.five,
    textAlign: 'center',
  },
});
