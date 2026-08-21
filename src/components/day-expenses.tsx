import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { MoneyColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import type { Transaction } from '@/db';
import { useCategoryEmoji } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay } from '@/lib/date';
import { formatMoney } from '@/lib/money';

type Props = {
  /** The day being shown, as a 'YYYY-MM-DD' key. */
  day: string;
  /** That day's entries, newest first. */
  entries: Transaction[];
  onPressEntry?: (id: string) => void;
};

/**
 * One day's spending: the total out on top, then every entry beneath it.
 * Money in is shown alongside the total only when there was some, so an
 * ordinary spending day stays a single clear number.
 */
export function DayExpenses({ day, entries, onPressEntry }: Props) {
  const theme = useTheme();
  const emojiFor = useCategoryEmoji();

  let spent = 0;
  let received = 0;
  for (const tx of entries) {
    if (tx.type === 'out') spent += tx.amount;
    else received += tx.amount;
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary">
          Spent on {formatRelativeDay(day)}
        </ThemedText>
        <ThemedText style={[styles.total, { color: spent > 0 ? MoneyColors.out : theme.text }]}>
          {formatMoney(spent)}
        </ThemedText>
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary">
            {entries.length === 0
              ? 'No entries'
              : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
          </ThemedText>
          {received > 0 && (
            <>
              <View style={[styles.dot, { backgroundColor: theme.backgroundSelected }]} />
              <ThemedText type="small" style={{ color: MoneyColors.in }}>
                {formatMoney(received)} in
              </ThemedText>
            </>
          )}
        </View>
      </View>

      {entries.length > 0 ? (
        <>
          <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
          <View>
            {entries.map((tx) => (
              <TransactionRow
                key={tx.id}
                transaction={tx}
                emoji={emojiFor(tx.category, tx.type)}
                showTime
                onPress={onPressEntry ? () => onPressEntry(tx.id) : undefined}
              />
            ))}
          </View>
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          Nothing recorded on this day. Tap “＋ Add Expense” to add one.
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
  },
  header: {
    gap: Spacing.half,
  },
  total: {
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 40,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 999,
  },
  divider: {
    height: 1,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  empty: {
    marginTop: Spacing.three,
  },
});
