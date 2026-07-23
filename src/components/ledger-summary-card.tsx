import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import type { LedgerTotals } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/money';

/** Net position on top, receivable / payable beneath. */
export function LedgerSummaryCard({ totals }: { totals: LedgerTotals }) {
  const theme = useTheme();
  const net = totals.receivable - totals.payable;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="small" themeColor="textSecondary">
        Net position
      </ThemedText>
      <ThemedText style={styles.net}>{formatMoney(net)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.netCaption}>
        {net > 0 ? 'Overall, you are owed' : net < 0 ? 'Overall, you owe' : 'All settled'}
      </ThemedText>

      <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />

      <View style={styles.legs}>
        <View style={styles.leg}>
          <View style={styles.legHeader}>
            <View style={[styles.dot, { backgroundColor: MoneyColors.in }]} />
            <ThemedText type="small" themeColor="textSecondary">
              They owe you
            </ThemedText>
          </View>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.term}>
            Receivable
          </ThemedText>
          <ThemedText type="subtitle" style={[styles.legValue, { color: MoneyColors.in }]}>
            {formatMoney(totals.receivable)}
          </ThemedText>
        </View>

        <View style={styles.leg}>
          <View style={styles.legHeader}>
            <View style={[styles.dot, { backgroundColor: MoneyColors.out }]} />
            <ThemedText type="small" themeColor="textSecondary">
              You owe
            </ThemedText>
          </View>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.term}>
            Payable
          </ThemedText>
          <ThemedText type="subtitle" style={[styles.legValue, { color: MoneyColors.out }]}>
            {formatMoney(totals.payable)}
          </ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.half,
  },
  net: {
    fontSize: 44,
    fontWeight: '700',
    lineHeight: 50,
  },
  netCaption: {
    marginBottom: Spacing.one,
  },
  divider: {
    height: 1,
    marginVertical: Spacing.three,
  },
  legs: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  leg: {
    flex: 1,
    gap: Spacing.one,
  },
  legHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  term: {
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    opacity: 0.75,
  },
  legValue: {
    fontSize: 24,
    lineHeight: 30,
  },
});
