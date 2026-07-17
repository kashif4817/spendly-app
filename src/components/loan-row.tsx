import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MoneyColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import { isLoanSettled, loanRemaining, type Loan } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay } from '@/lib/date';
import { formatMoney, formatSigned } from '@/lib/money';

type Props = {
  loan: Loan;
  onPress?: () => void;
};

export function LoanRow({ loan, onPress }: Props) {
  const theme = useTheme();
  const isGiven = loan.direction === 'given';
  const color = isGiven ? MoneyColors.in : MoneyColors.out;
  const settled = isLoanSettled(loan);
  const remaining = loanRemaining(loan);
  const partial = !settled && loan.repaid > 0;

  const subtitle = settled
    ? 'Settled ✓'
    : partial
      ? `${formatMoney(loan.repaid)} repaid of ${formatMoney(loan.amount)}`
      : loan.note?.trim() || formatRelativeDay(loan.day);

  const initial = loan.person.trim().charAt(0).toUpperCase() || '?';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      accessibilityRole="button">
      <View style={[styles.iconWrap, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText style={[styles.initial, !settled && { color }]}>{initial}</ThemedText>
      </View>

      <View style={styles.middle}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {loan.person}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {subtitle}
        </ThemedText>
        {partial && (
          <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
            <View
              style={[
                styles.fill,
                {
                  backgroundColor: color,
                  width: `${Math.min(100, (loan.repaid / loan.amount) * 100)}%`,
                },
              ]}
            />
          </View>
        )}
      </View>

      {settled ? (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {formatMoney(loan.amount)}
        </ThemedText>
      ) : (
        <ThemedText type="smallBold" style={{ color }}>
          {formatSigned(isGiven ? remaining : -remaining)}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontSize: 18,
    fontWeight: '700',
  },
  middle: {
    flex: 1,
    gap: 1,
  },
  track: {
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: Spacing.one,
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
});
