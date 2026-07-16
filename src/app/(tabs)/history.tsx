import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getAllTransactions, type Transaction } from '@/db';
import { useCategoryEmoji, useQuery } from '@/db/hooks';
import { formatRelativeDay } from '@/lib/date';
import { formatSigned } from '@/lib/money';

type DaySection = {
  day: string;
  net: number;
  data: Transaction[];
};

export default function HistoryScreen() {
  const router = useRouter();
  const all = useQuery(() => getAllTransactions());
  const emojiFor = useCategoryEmoji();

  const sections = useMemo<DaySection[]>(() => {
    const map = new Map<string, DaySection>();
    for (const tx of all) {
      let section = map.get(tx.day);
      if (!section) {
        section = { day: tx.day, net: 0, data: [] };
        map.set(tx.day, section);
      }
      section.data.push(tx);
      section.net += tx.type === 'in' ? tx.amount : -tx.amount;
    }
    return Array.from(map.values());
  }, [all]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <ThemedText type="title" style={styles.title}>
              History
            </ThemedText>
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <ThemedText type="smallBold">{formatRelativeDay(section.day)}</ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary">
                {formatSigned(section.net)}
              </ThemedText>
            </View>
          )}
          renderItem={({ item }) => (
            <TransactionRow
              transaction={item}
              emoji={emojiFor(item.category, item.type)}
              onPress={() => router.push({ pathname: '/entry', params: { id: item.id } })}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>📭</ThemedText>
              <ThemedText type="smallBold">Nothing recorded yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Your entries will show up here, grouped by day.
              </ThemedText>
            </View>
          }
        />
      </SafeAreaView>
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
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
    marginBottom: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.one,
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
