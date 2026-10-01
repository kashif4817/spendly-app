import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MoneyColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import type { Transaction } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay, formatTime } from '@/lib/date';
import { formatSigned } from '@/lib/money';

type Props = {
  transaction: Transaction;
  emoji: string;
  onPress?: () => void;
  /** Show the time of day instead of the category as the subtitle. */
  showTime?: boolean;
  /** Show the transaction day and time (for a cross-day recent-activity list). */
  showDateAndTime?: boolean;
  /**
   * The row already sits inside a card, so draw it flat. Otherwise each row is
   * its own small card on the page background.
   */
  inset?: boolean;
};

export function TransactionRow({
  transaction,
  emoji,
  onPress,
  showTime,
  showDateAndTime,
  inset,
}: Props) {
  const theme = useTheme();
  const isIn = transaction.type === 'in';
  const color = isIn ? MoneyColors.in : MoneyColors.out;

  const subtitle = showDateAndTime
    ? `${formatRelativeDay(transaction.day)} · ${formatTime(transaction.created_at)}`
    : transaction.note?.trim()
      ? transaction.note.trim()
      : showTime
        ? formatTime(transaction.created_at)
        : transaction.category;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !inset && [styles.card, { backgroundColor: theme.backgroundElement }],
        pressed && { opacity: 0.6 },
      ]}
      accessibilityRole="button">
      <View style={[styles.iconWrap, { backgroundColor: theme.background }]}>
        <ThemedText style={styles.emoji}>{emoji}</ThemedText>
      </View>

      <View style={styles.middle}>
        <View style={styles.titleRow}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.titleText}>
            {transaction.category}
          </ThemedText>
          {transaction.receipt_path ? (
            <MaterialIcons name="receipt-long" size={13} color={theme.textSecondary} />
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {subtitle}
        </ThemedText>
      </View>

      <ThemedText type="smallBold" style={{ color }}>
        {formatSigned(isIn ? transaction.amount : -transaction.amount)}
      </ThemedText>
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
  card: {
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    marginBottom: 6,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 18,
  },
  middle: {
    flex: 1,
    gap: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  titleText: {
    flexShrink: 1,
  },
});
