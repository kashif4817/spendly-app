import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BalanceCard } from '@/components/balance-card';
import { HBar, VerticalBars, type VerticalBar } from '@/components/bar-chart';
import { BudgetBar } from '@/components/budget-bar';
import { MonthlyInsights } from '@/components/monthly-insights';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  getAllTransactions,
  getBudgetProgress,
  getCategoryBreakdown,
  getDailyTotals,
  getTotals,
  OVERALL_BUDGET,
  type EntryType,
  type Transaction,
} from '@/db';
import { useCategoryEmoji, useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import {
  addDays,
  formatMonth,
  formatRelativeDay,
  formatWeekRange,
  monthEnd,
  monthStart,
  todayKey,
  weekdayLetter,
  weekEnd,
  weekStart,
} from '@/lib/date';
import { formatMoney, formatSigned } from '@/lib/money';

type Period = 'daily' | 'weekly';

type DaySection = {
  day: string;
  net: number;
  data: Transaction[];
};

export default function ReportsScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('daily');
  const [anchor, setAnchor] = useState(todayKey());
  const [breakdown, setBreakdown] = useState<EntryType>('out');
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const emojiFor = useCategoryEmoji();
  const theme = useTheme();

  // Budgets always track the current calendar month, whatever period is shown.
  const today = todayKey();
  const budgets = useQuery(() => getBudgetProgress(monthStart(today), monthEnd(today)), [today]);

  const { start, end } = useMemo(() => {
    if (period === 'daily') return { start: anchor, end: anchor };
    return { start: weekStart(anchor), end: weekEnd(anchor) };
  }, [period, anchor]);

  const totals = useQuery(() => getTotals(start, end), [start, end]);
  const slices = useQuery(
    () => getCategoryBreakdown(start, end, breakdown),
    [start, end, breakdown]
  );
  const dailyTotals = useQuery(
    () => (period === 'weekly' ? getDailyTotals(start, end) : []),
    [period, start, end]
  );

  // Move the period backward/forward; never past the current day/week.
  const step = period === 'daily' ? 1 : 7;
  const nextDisabled =
    period === 'daily'
      ? anchor >= todayKey()
      : weekStart(anchor) >= weekStart(todayKey());

  function go(direction: -1 | 1) {
    if (direction === 1 && nextDisabled) return;
    setAnchor((a) => addDays(a, direction * step));
  }

  const periodLabel =
    period === 'daily' ? formatRelativeDay(anchor) : formatWeekRange(weekStart(anchor));

  // Build the 7 days of the week with full in/out info (drives bars + tap detail).
  const weekDays = useMemo(() => {
    if (period !== 'weekly') return [];
    const byDay = new Map(dailyTotals.map((d) => [d.day, d]));
    const today = todayKey();
    return Array.from({ length: 7 }, (_, i) => {
      const key = addDays(start, i);
      const row = byDay.get(key);
      return {
        key,
        label: weekdayLetter(key),
        income: row?.income ?? 0,
        expense: row?.expense ?? 0,
        highlight: key === today,
      };
    });
  }, [period, dailyTotals, start]);

  const weekBars: VerticalBar[] = useMemo(
    () => weekDays.map((d) => ({ label: d.label, value: d.expense, highlight: d.highlight })),
    [weekDays]
  );

  const selectedIndex = weekDays.findIndex((d) => d.key === selectedDayKey);
  const selectedDay = selectedIndex >= 0 ? weekDays[selectedIndex] : null;

  // Drop the day selection whenever the week or period changes.
  useEffect(() => {
    setSelectedDayKey(null);
  }, [start, period]);

  const maxSlice = Math.max(1, ...slices.map((s) => s.total));
  const breakdownColor = breakdown === 'in' ? MoneyColors.in : MoneyColors.out;

  // --- History (merged in): searchable, day-grouped transaction list ---------
  const all = useQuery(() => getAllTransactions());
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (tx) =>
        tx.category.toLowerCase().includes(q) ||
        tx.note.toLowerCase().includes(q) ||
        String(tx.amount).includes(q)
    );
  }, [all, search]);

  const sections = useMemo<DaySection[]>(() => {
    const map = new Map<string, DaySection>();
    for (const tx of filtered) {
      let section = map.get(tx.day);
      if (!section) {
        section = { day: tx.day, net: 0, data: [] };
        map.set(tx.day, section);
      }
      section.data.push(tx);
      section.net += tx.type === 'in' ? tx.amount : -tx.amount;
    }
    return Array.from(map.values());
  }, [filtered]);

  const header = (
    <View style={styles.header}>
      <ThemedText type="title" style={styles.title}>
        Reports
      </ThemedText>

      <MonthlyInsights />

      <Pressable
        onPress={() => router.push('/advanced-report' as Href)}
        style={({ pressed }) => [
          styles.advBtn,
          { backgroundColor: theme.backgroundElement },
          pressed && { opacity: 0.7 },
        ]}>
        <MaterialIcons name="insights" size={20} color="#0B7C4F" />
        <ThemedText type="smallBold" style={styles.advLabel}>
          Advanced report
        </ThemedText>
        <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
      </Pressable>

      <Segmented
        value={period}
        onChange={(p) => setPeriod(p)}
        options={[
          { label: 'Daily', value: 'daily' },
          { label: 'Weekly', value: 'weekly' },
        ]}
      />

      {/* Period navigator */}
      <View style={styles.nav}>
        <Pressable onPress={() => go(-1)} hitSlop={8} style={styles.navBtn}>
          <ThemedText style={styles.navArrow}>‹</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={styles.navLabel}>
          {periodLabel}
        </ThemedText>
        <Pressable onPress={() => go(1)} hitSlop={8} style={styles.navBtn}>
          <ThemedText style={[styles.navArrow, nextDisabled && styles.disabled]}>›</ThemedText>
        </Pressable>
      </View>

      <BalanceCard label={period === 'daily' ? 'This day' : 'This week'} totals={totals} />

      {/* Weekly per-day spending chart */}
      {period === 'weekly' && (
        <ThemedView type="backgroundElement" style={styles.chartCard}>
          <ThemedText type="smallBold" style={styles.chartTitle}>
            Spending by day
          </ThemedText>
          <VerticalBars
            data={weekBars}
            color={MoneyColors.out}
            selectedIndex={selectedIndex >= 0 ? selectedIndex : null}
            onSelectBar={(i) =>
              setSelectedDayKey((cur) => (cur === weekDays[i].key ? null : weekDays[i].key))
            }
          />

          {selectedDay ? (
            <View style={styles.dayDetail}>
              <View style={[styles.dayDivider, { backgroundColor: theme.backgroundSelected }]} />
              <View style={styles.dayDetailHeader}>
                <ThemedText type="smallBold">{formatRelativeDay(selectedDay.key)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Net {formatSigned(selectedDay.income - selectedDay.expense)}
                </ThemedText>
              </View>
              <View style={styles.dayLegs}>
                <View style={styles.dayLeg}>
                  <View style={[styles.dot, { backgroundColor: MoneyColors.in }]} />
                  <ThemedText type="small" themeColor="textSecondary">
                    In
                  </ThemedText>
                  <ThemedText type="smallBold" style={[styles.dayLegValue, { color: MoneyColors.in }]}>
                    {formatMoney(selectedDay.income)}
                  </ThemedText>
                </View>
                <View style={styles.dayLeg}>
                  <View style={[styles.dot, { backgroundColor: MoneyColors.out }]} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Out
                  </ThemedText>
                  <ThemedText type="smallBold" style={[styles.dayLegValue, { color: MoneyColors.out }]}>
                    {formatMoney(selectedDay.expense)}
                  </ThemedText>
                </View>
              </View>
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.chartHint}>
              Tap a bar to see that day&apos;s in &amp; out.
            </ThemedText>
          )}
        </ThemedView>
      )}

      {/* Breakdown by category */}
      <View style={styles.breakdownHeader}>
        <ThemedText type="smallBold">By category</ThemedText>
        <View style={styles.breakdownToggle}>
          <Segmented
            value={breakdown}
            onChange={(b) => setBreakdown(b)}
            options={[
              { label: 'Out', value: 'out', color: MoneyColors.out },
              { label: 'In', value: 'in', color: MoneyColors.in },
            ]}
          />
        </View>
      </View>

      {slices.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBreakdown}>
          No {breakdown === 'in' ? 'income' : 'spending'} recorded for this period.
        </ThemedText>
      ) : (
        <View style={styles.slices}>
          {slices.map((slice) => (
            <View key={slice.category} style={styles.slice}>
              <View style={styles.sliceTop}>
                <ThemedText type="small" style={styles.sliceLabel} numberOfLines={1}>
                  {emojiFor(slice.category, breakdown)}  {slice.category}
                </ThemedText>
                <ThemedText type="smallBold">{formatMoney(slice.total)}</ThemedText>
              </View>
              <HBar value={slice.total} max={maxSlice} color={breakdownColor} />
            </View>
          ))}
        </View>
      )}

      {/* Monthly budgets */}
      <View style={styles.budgetHeader}>
        <ThemedText type="smallBold">Budgets · {formatMonth(today)}</ThemedText>
        <Pressable onPress={() => router.push('/budgets')} hitSlop={8}>
          <ThemedText type="smallBold" style={styles.budgetEdit}>
            {budgets.length > 0 ? 'Edit' : 'Set up'}
          </ThemedText>
        </Pressable>
      </View>

      {budgets.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBreakdown}>
          Set monthly limits to see how your spending tracks against them.
        </ThemedText>
      ) : (
        <ThemedView type="backgroundElement" style={styles.budgetCard}>
          {budgets.map((b) => (
            <BudgetBar
              key={b.category || '(overall)'}
              label={
                b.category === OVERALL_BUDGET
                  ? '🎯  All spending'
                  : `${emojiFor(b.category, 'out')}  ${b.category}`
              }
              spent={b.spent}
              budget={b.budget}
            />
          ))}
        </ThemedView>
      )}

      {/* History */}
      <ThemedText type="smallBold" style={styles.historyTitle}>
        History
      </ThemedText>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search category, note or amount"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
      />
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <ThemedText type="smallBold">{formatRelativeDay(section.day)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
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
              {search ? (
                <>
                  <ThemedText style={styles.emptyEmoji}>🔍</ThemedText>
                  <ThemedText type="smallBold">No matches</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                    Nothing found for “{search.trim()}”.
                  </ThemedText>
                </>
              ) : (
                <>
                  <ThemedText style={styles.emptyEmoji}>📭</ThemedText>
                  <ThemedText type="smallBold">Nothing recorded yet</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                    Your entries will show up here, grouped by day.
                  </ThemedText>
                </>
              )}
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
  header: {
    gap: Spacing.three,
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
  },
  advBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  advLabel: {
    flex: 1,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrow: {
    fontSize: 28,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.3,
  },
  navLabel: {
    flex: 1,
    textAlign: 'center',
  },
  chartCard: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  chartTitle: {
    marginBottom: Spacing.one,
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
    gap: Spacing.three,
  },
  breakdownToggle: {
    width: 140,
  },
  emptyBreakdown: {
    paddingVertical: Spacing.three,
  },
  slices: {
    gap: Spacing.three,
  },
  slice: {
    gap: Spacing.two,
  },
  sliceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  sliceLabel: {
    flex: 1,
  },
  dayDetail: {
    gap: Spacing.two,
  },
  dayDivider: {
    height: 1,
    marginBottom: Spacing.one,
  },
  dayDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayLegs: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  dayLeg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  dayLegValue: {
    marginLeft: 'auto',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  chartHint: {
    textAlign: 'center',
    paddingTop: Spacing.one,
  },
  budgetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  budgetEdit: {
    color: '#208AEF',
  },
  budgetCard: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  historyTitle: {
    marginTop: Spacing.three,
    fontSize: 18,
  },
  search: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
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
