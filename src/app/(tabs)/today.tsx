import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddButton } from '@/components/add-button';
import { useTheme } from '@/hooks/use-theme';
import { BalanceCard } from '@/components/balance-card';
import { BudgetBar } from '@/components/budget-bar';
import { DayExpenses } from '@/components/day-expenses';
import { MonthCalendar } from '@/components/month-calendar';
import { Segmented, type SegmentOption } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  getBudgetProgress,
  getDailyTotals,
  getTotals,
  getTransactionsByDay,
  OVERALL_BUDGET,
} from '@/db';
import { useCategoryEmoji, useQuery } from '@/db/hooks';
import {
  addMonths,
  formatMonth,
  formatRelativeDay,
  monthEnd,
  monthStart,
  todayKey,
} from '@/lib/date';
import { formatMoney } from '@/lib/money';

/** A range wide enough to cover every entry, for the all-time total. */
const ALL_TIME = { start: '0001-01-01', end: '9999-12-31' };

type Tab = 'today' | 'calendar';

const TABS: SegmentOption<Tab>[] = [
  { label: 'Today', value: 'today' },
  { label: 'Calendar', value: 'calendar' },
];

export default function ExpensesScreen() {
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('today');

  // The month on screen, and the day whose entries the calendar tab shows
  // beneath it. Kept here so the calendar is where the user left it when they
  // switch tabs and come back.
  const [month, setMonth] = useState(() => monthStart(todayKey()));
  const [selected, setSelected] = useState(todayKey());

  const isToday = selected === todayKey();

  /**
   * Step a month at a time, never past the current one. The selection follows
   * so the day panel always belongs to the month on screen: today when it's
   * this month, otherwise the 1st.
   */
  function goMonth(delta: -1 | 1) {
    const next = monthStart(addMonths(month, delta));
    if (next > monthStart(todayKey())) return;
    setMonth(next);
    setSelected(next === monthStart(todayKey()) ? todayKey() : next);
  }

  function jumpToToday() {
    setMonth(monthStart(todayKey()));
    setSelected(todayKey());
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <ThemedText type="title" style={styles.title}>
              Expenses
            </ThemedText>
            {tab === 'calendar' && !isToday && (
              <Pressable onPress={jumpToToday} hitSlop={8}>
                <ThemedText type="smallBold" style={[styles.jump, { color: theme.accent }]}>
                  Today
                </ThemedText>
              </Pressable>
            )}
          </View>
          <Segmented options={TABS} value={tab} onChange={setTab} />
        </View>

        {tab === 'today' ? (
          <TodayTab />
        ) : (
          <CalendarTab
            month={month}
            selected={selected}
            onSelect={setSelected}
            onChangeMonth={goMonth}
          />
        )}
      </SafeAreaView>
      <AddButton
        label="Add Expense"
        href={
          tab === 'calendar'
            ? ({ pathname: '/entry', params: { day: selected } } as Href)
            : ('/entry' as Href)
        }
      />
    </ThemedView>
  );
}

/** Today's entries, with the day's balance and the month budget above them. */
function TodayTab() {
  const router = useRouter();
  const day = todayKey();

  const entries = useQuery(() => getTransactionsByDay(day), [day]);
  const totals = useQuery(() => getTotals(day, day), [day]);
  const budgets = useQuery(() => getBudgetProgress(monthStart(day), monthEnd(day)), [day]);
  const emojiFor = useCategoryEmoji();

  const overallBudget = budgets.find((b) => b.category === OVERALL_BUDGET);

  return (
    <FlatList
      data={entries}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View style={styles.todayHeader}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatRelativeDay(day)}
          </ThemedText>
          <View style={styles.cardWrap}>
            <BalanceCard label="Today's balance" totals={totals} />
          </View>
          {overallBudget && (
            <Pressable onPress={() => router.push('/budgets')}>
              <ThemedView type="backgroundElement" style={styles.budgetCard}>
                <BudgetBar
                  label={`🎯  ${formatMonth(day)} budget`}
                  spent={overallBudget.spent}
                  budget={overallBudget.budget}
                />
              </ThemedView>
            </Pressable>
          )}
          {entries.length > 0 && (
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              Entries
            </ThemedText>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <TransactionRow
          transaction={item}
          emoji={emojiFor(item.category, item.type)}
          showTime
          onPress={() => router.push({ pathname: '/entry', params: { id: item.id } })}
        />
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <ThemedText style={styles.emptyEmoji}>🧾</ThemedText>
          <ThemedText type="smallBold">No entries yet today</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
            Tap “＋ Add Expense” to record money in or out.
          </ThemedText>
        </View>
      }
    />
  );
}

type CalendarTabProps = {
  month: string;
  selected: string;
  onSelect: (day: string) => void;
  onChangeMonth: (delta: -1 | 1) => void;
};

/** The month grid, its spending summary, and the selected day's entries. */
function CalendarTab({ month, selected, onSelect, onChangeMonth }: CalendarTabProps) {
  const router = useRouter();

  const monthDays = useQuery(() => getDailyTotals(month, monthEnd(month)), [month]);
  const monthTotals = useQuery(() => getTotals(month, monthEnd(month)), [month]);
  const allTime = useQuery(() => getTotals(ALL_TIME.start, ALL_TIME.end));
  const entries = useQuery(() => getTransactionsByDay(selected), [selected]);

  return (
    <ScrollView
      contentContainerStyle={[styles.content, styles.calendarContent]}
      showsVerticalScrollIndicator={false}>
      <MonthCalendar
        month={month}
        selected={selected}
        totals={monthDays}
        onSelect={onSelect}
        onChangeMonth={onChangeMonth}
      />

      {/* Spending for the month on screen, next to the lifetime figure. */}
      <ThemedView type="backgroundElement" style={styles.summary}>
        <Stat label={formatMonth(month)} value={monthTotals.expense} />
        <View style={styles.summaryDivider} />
        <Stat label="All time" value={allTime.expense} />
      </ThemedView>

      <DayExpenses
        day={selected}
        entries={entries}
        onPressEntry={(id) => router.push({ pathname: '/entry', params: { id } })}
      />
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText style={styles.statValue}>{formatMoney(value)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.statCaption}>
        spent
      </ThemedText>
    </View>
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
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
  },
  jump: {
    paddingBottom: Spacing.two,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  calendarContent: {
    gap: Spacing.three,
  },
  todayHeader: {
    gap: Spacing.one,
  },
  cardWrap: {
    marginTop: Spacing.three,
  },
  budgetCard: {
    marginTop: Spacing.two,
    borderRadius: Spacing.four,
    padding: Spacing.three,
  },
  sectionTitle: {
    marginTop: Spacing.four,
    marginBottom: Spacing.one,
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
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.four,
    padding: Spacing.four,
  },
  stat: {
    flex: 1,
    gap: Spacing.half,
  },
  statValue: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    color: MoneyColors.out,
  },
  statCaption: {
    fontSize: 12,
  },
  summaryDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginHorizontal: Spacing.three,
    backgroundColor: 'rgba(128,128,128,0.25)',
  },
});
