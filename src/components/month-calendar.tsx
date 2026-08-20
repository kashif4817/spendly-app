import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import type { DayTotal } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { useWeekStart } from '@/hooks/use-week-start';
import {
  addDays,
  formatFullDate,
  formatMonth,
  keyToDate,
  monthEnd,
  monthStart,
  todayKey,
  weekdayHeadings,
} from '@/lib/date';
import { formatCompact } from '@/lib/money';

const ACCENT = '#0B7C4F';

type Props = {
  /** Any day key inside the month to display. */
  month: string;
  /** The highlighted day — drives the entry list underneath. */
  selected: string;
  /** Per-day in/out for the displayed month; days not listed are zero. */
  totals: DayTotal[];
  onSelect: (day: string) => void;
  onChangeMonth: (delta: -1 | 1) => void;
};

/**
 * A month grid of spending. Each cell shows the day number plus that day's
 * money out (or money in, when nothing was spent); days with both get a small
 * green dot. Future days are dimmed and unselectable, since entries can't be
 * dated ahead.
 */
export function MonthCalendar({ month, selected, totals, onSelect, onChangeMonth }: Props) {
  const theme = useTheme();
  const weekStartsOn = useWeekStart();
  const today = todayKey();
  const start = monthStart(month);
  const dayCount = keyToDate(monthEnd(month)).getDate();
  const headings = weekdayHeadings(weekStartsOn);
  // Blanks before the 1st, so it lands under the right weekday column.
  const leading = (keyToDate(start).getDay() - weekStartsOn + 7) % 7;
  const byDay = new Map(totals.map((t) => [t.day, t]));
  const nextDisabled = start >= monthStart(today);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.nav}>
        <Pressable onPress={() => onChangeMonth(-1)} hitSlop={8} style={styles.navBtn}>
          <ThemedText style={styles.navArrow}>‹</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={styles.navLabel}>
          {formatMonth(month)}
        </ThemedText>
        <Pressable
          onPress={() => onChangeMonth(1)}
          disabled={nextDisabled}
          hitSlop={8}
          style={styles.navBtn}>
          <ThemedText style={[styles.navArrow, nextDisabled && styles.dim]}>›</ThemedText>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {headings.map((label) => (
          <View key={label} style={styles.cell}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.weekday}>
              {label}
            </ThemedText>
          </View>
        ))}

        {Array.from({ length: leading }, (_, i) => (
          <View key={`blank-${i}`} style={styles.cell} />
        ))}

        {Array.from({ length: dayCount }, (_, i) => {
          const key = addDays(start, i);
          const row = byDay.get(key);
          const expense = row?.expense ?? 0;
          const income = row?.income ?? 0;
          const isSelected = key === selected;
          const isFuture = key > today;
          const amount = expense > 0 ? expense : income;
          const amountColor = isSelected
            ? '#ffffff'
            : expense > 0
              ? MoneyColors.out
              : MoneyColors.in;

          return (
            <Pressable
              key={key}
              onPress={() => onSelect(key)}
              disabled={isFuture}
              style={[styles.cell, isFuture && styles.dim]}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled: isFuture }}
              accessibilityLabel={formatFullDate(key)}>
              <View
                style={[
                  styles.day,
                  key === today && { borderColor: ACCENT },
                  isSelected && { backgroundColor: ACCENT, borderColor: ACCENT },
                ]}>
                <ThemedText style={[styles.dayNum, isSelected && styles.onAccent]}>
                  {i + 1}
                </ThemedText>
                {amount > 0 ? (
                  <ThemedText style={[styles.amount, { color: amountColor }]} numberOfLines={1}>
                    {formatCompact(amount)}
                  </ThemedText>
                ) : (
                  <View style={styles.amountSpacer} />
                )}
              </View>
              {expense > 0 && income > 0 && (
                <View
                  style={[
                    styles.inDot,
                    { backgroundColor: isSelected ? '#ffffff' : MoneyColors.in },
                  ]}
                />
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.legend, { borderTopColor: theme.backgroundSelected }]}>
        <View style={[styles.legendDot, { backgroundColor: MoneyColors.out }]} />
        <ThemedText type="small" themeColor="textSecondary">
          Out
        </ThemedText>
        <View style={[styles.legendDot, { backgroundColor: MoneyColors.in }]} />
        <ThemedText type="small" themeColor="textSecondary">
          In
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.legendHint}>
          Tap a day
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navBtn: {
    width: 44,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrow: {
    fontSize: 28,
    fontWeight: '600',
  },
  navLabel: {
    flex: 1,
    textAlign: 'center',
  },
  dim: {
    opacity: 0.3,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '14.2857%',
    paddingVertical: 2,
    alignItems: 'center',
  },
  weekday: {
    fontSize: 11,
    lineHeight: 18,
  },
  day: {
    width: '100%',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayNum: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  onAccent: {
    color: '#ffffff',
  },
  amount: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
  },
  amountSpacer: {
    height: 12,
  },
  inDot: {
    position: 'absolute',
    top: 4,
    right: 6,
    width: 5,
    height: 5,
    borderRadius: 999,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderTopWidth: 1,
    paddingTop: Spacing.two,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    marginLeft: Spacing.two,
  },
  legendHint: {
    flex: 1,
    textAlign: 'right',
  },
});
