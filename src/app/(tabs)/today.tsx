import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddButton } from '@/components/add-button';
import { BalanceCard } from '@/components/balance-card';
import { BudgetBar } from '@/components/budget-bar';
import { MonthCalendar } from '@/components/month-calendar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  getBudgetProgress,
  getDailyTotals,
  getTotals,
  getTransactionsByDay,
  OVERALL_BUDGET,
} from '@/db';
import { useCategoryEmoji, useQuery } from '@/db/hooks';
import { addMonths, formatMonth, formatRelativeDay, monthEnd, monthStart, todayKey } from '@/lib/date';
import { formatSigned } from '@/lib/money';

export default function TodayScreen() {
  const router = useRouter();
  const emojiFor = useCategoryEmoji();

  // The month shown in the calendar, and the day whose entries are listed.
  const [month, setMonth] = useState(() => monthStart(todayKey()));
  const [selected, setSelected] = useState(todayKey());

  const monthDays = useQuery(() => getDailyTotals(month, monthEnd(month)), [month]);
  const monthTotals = useQuery(() => getTotals(month, monthEnd(month)), [month]);
  const budgets = useQuery(() => getBudgetProgress(month, monthEnd(month)), [month]);
  const entries = useQuery(() => getTransactionsByDay(selected), [selected]);

  const overallBudget = budgets.find((b) => b.category === OVERALL_BUDGET);
  const dayNet = entries.reduce((sum, tx) => sum + (tx.type === 'in' ? tx.amount : -tx.amount), 0);
  const isToday = selected === todayKey();

  /**
   * Step the calendar a month at a time, never past the current one. The
   * selection follows along so the list below always belongs to the month on
   * screen — today when it's the current month, otherwise the 1st.
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
        <FlatList
          data={entries}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.header}>
              <ThemedText type="title" style={styles.title}>
                Expenses
              </ThemedText>

              <View style={styles.calendarWrap}>
                <MonthCalendar
                  month={month}
                  selected={selected}
                  totals={monthDays}
                  onSelect={setSelected}
                  onChangeMonth={goMonth}
                />
              </View>

              <View style={styles.cardWrap}>
                <BalanceCard label={`${formatMonth(month)} balance`} totals={monthTotals} />
              </View>

              {overallBudget && (
                <Pressable onPress={() => router.push('/budgets')}>
                  <ThemedView type="backgroundElement" style={styles.budgetCard}>
                    <BudgetBar
                      label={`🎯  ${formatMonth(month)} budget`}
                      spent={overallBudget.spent}
                      budget={overallBudget.budget}
                    />
                  </ThemedView>
                </Pressable>
              )}

              <View style={styles.dayHeader}>
                <ThemedText type="smallBold">{formatRelativeDay(selected)}</ThemedText>
                {entries.length > 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatSigned(dayNet)}
                  </ThemedText>
                ) : !isToday ? (
                  <Pressable onPress={jumpToToday} hitSlop={8}>
                    <ThemedText type="small" style={styles.jump}>
                      Jump to today
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
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
              <ThemedText type="smallBold">
                {isToday ? 'No entries yet today' : 'Nothing on this day'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Tap “＋ Add Expense” to record money in or out.
              </ThemedText>
            </View>
          }
        />
      </SafeAreaView>
      <AddButton
        label="Add Expense"
        href={{ pathname: '/entry', params: { day: selected } } as Href}
      />
    </ThemedView>
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
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  header: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
  },
  calendarWrap: {
    marginTop: Spacing.three,
  },
  cardWrap: {
    marginTop: Spacing.three,
  },
  budgetCard: {
    marginTop: Spacing.two,
    borderRadius: Spacing.four,
    padding: Spacing.three,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.four,
    marginBottom: Spacing.one,
  },
  jump: {
    color: '#0B7C4F',
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
