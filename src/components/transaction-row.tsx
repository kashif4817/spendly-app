import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MoneyColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import type { Transaction } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { formatSigned } from '@/lib/money';

type Props = {
  transaction: Transaction;
  emoji: string;
  onPress?: () => void;
  /** Show the time of day instead of the category as the subtitle. */
  showTime?: boolean;
};

export function TransactionRow({ transaction, emoji, onPress, showTime }: Props) {
  const theme = useTheme();
  const isIn = transaction.type === 'in';
  const color = isIn ? MoneyColors.in : MoneyColors.out;

  const subtitle = transaction.note?.trim()
    ? transaction.note.trim()
    : showTime
      ? timeOf(transaction.created_at)
      : transaction.category;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      accessibilityRole="button">
      <View style={[styles.iconWrap, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText style={styles.emoji}>{emoji}</ThemedText>
      </View>

      <View style={styles.middle}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {transaction.category}
        </ThemedText>
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

function timeOf(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
  emoji: {
    fontSize: 18,
  },
  middle: {
    flex: 1,
    gap: 1,
  },
});
