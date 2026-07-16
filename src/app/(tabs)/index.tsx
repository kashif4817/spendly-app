import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddButton } from '@/components/add-button';
import { BalanceCard } from '@/components/balance-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getTotals, getTransactionsByDay } from '@/db';
import { useCategoryEmoji, useQuery } from '@/db/hooks';
import { formatRelativeDay, todayKey } from '@/lib/date';

export default function TodayScreen() {
  const router = useRouter();
  const day = todayKey();

  const entries = useQuery(() => getTransactionsByDay(day), [day]);
  const totals = useQuery(() => getTotals(day, day), [day]);
  const emojiFor = useCategoryEmoji();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <FlatList
          data={entries}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.header}>
              <ThemedText type="title" style={styles.title}>
                Today
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatRelativeDay(day)}
              </ThemedText>
              <View style={styles.cardWrap}>
                <BalanceCard label="Today's balance" totals={totals} />
              </View>
              {entries.length > 0 && (
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  Entries
                </ThemedText>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <TransactionRow
              transaction={item}
              emoji={emojiFor(item.category, item.type)}
              showTime
              onPress={() => router.push({ pathname: '/entry', params: { id: item.id } })}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>🧾</ThemedText>
              <ThemedText type="smallBold">No entries yet today</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Tap “＋ Add” to record money in or out.
              </ThemedText>
            </View>
          }
        />
      </SafeAreaView>
      <AddButton />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
  title: {
    fontSize: 40,
    lineHeight: 46,
  },
  cardWrap: {
    marginTop: Spacing.three,
  },
  sectionTitle: {
    marginTop: Spacing.four,
    marginBottom: Spacing.one,
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
