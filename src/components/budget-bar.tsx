import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CategoryIcon } from '@/constants/categories';
import { BudgetColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney } from '@/lib/money';

type Props = {
  label: string;
  /** The category's icon, drawn beside its name. */
  icon?: CategoryIcon;
  spent: number;
  budget: number;
};

/** One budget's progress: label + "left/over" status, bar, spent-of-limit. */
export function BudgetBar({ label, icon, spent, budget }: Props) {
  const theme = useTheme();
  const ratio = budget > 0 ? spent / budget : 0;
  const color =
    ratio >= 1 ? BudgetColors.over : ratio >= 0.8 ? BudgetColors.warn : BudgetColors.ok;
  const left = budget - spent;

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <View style={styles.labelRow}>
          {!!icon && <MaterialIcons name={icon} size={15} color={theme.textSecondary} />}
          <ThemedText type="small" numberOfLines={1} style={styles.label}>
            {label}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" style={{ color }}>
          {left >= 0 ? `${formatMoney(left)} left` : `Over by ${formatMoney(-left)}`}
        </ThemedText>
      </View>
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View
          style={[
            styles.fill,
            { backgroundColor: color, width: `${Math.min(100, ratio * 100)}%` },
          ]}
        />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {formatMoney(spent)} spent of {formatMoney(budget)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.one,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
    minWidth: 0,
  },
  label: {
    flexShrink: 1,
  },
  track: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
});
