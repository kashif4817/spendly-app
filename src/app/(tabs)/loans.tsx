import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddButton } from '@/components/add-button';
import { LoanRow } from '@/components/loan-row';
import { LoanSummaryCard } from '@/components/loan-summary-card';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getLoans, getLoanTotals, isLoanSettled } from '@/db';
import { useQuery } from '@/db/hooks';

type Filter = 'open' | 'settled';

export default function LoansScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('open');

  const loans = useQuery(() => getLoans());
  const totals = useQuery(() => getLoanTotals());

  const filtered = useMemo(
    () => loans.filter((loan) => isLoanSettled(loan) === (filter === 'settled')),
    [loans, filter]
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.header}>
              <ThemedText type="title" style={styles.title}>
                Loans
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Money you&apos;ve lent or borrowed
              </ThemedText>
              <View style={styles.cardWrap}>
                <LoanSummaryCard totals={totals} />
              </View>
              <View style={styles.filterWrap}>
                <Segmented
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { label: 'Open', value: 'open' },
                    { label: 'Settled', value: 'settled' },
                  ]}
                />
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <LoanRow
              loan={item}
              onPress={() => router.push({ pathname: '/loan', params: { id: item.id } })}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>🤝</ThemedText>
              <ThemedText type="smallBold">
                {filter === 'open' ? 'No open loans' : 'No settled loans yet'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                {filter === 'open'
                  ? 'Tap “＋ Add” to record money you lent to someone or borrowed from them.'
                  : 'Loans show up here once they are fully repaid.'}
              </ThemedText>
            </View>
          }
        />
      </SafeAreaView>
      <AddButton href="/loan" />
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
  filterWrap: {
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
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
