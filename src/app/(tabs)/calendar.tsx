import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddButton } from '@/components/add-button';
import { DayExpenses } from '@/components/day-expenses';
import { MonthCalendar } from '@/components/month-calendar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getDailyTotals, getTotals, getTransactionsByDay } from '@/db';
import { useQuery } from '@/db/hooks';
import { addMonths, formatMonth, monthEnd, monthStart, todayKey } from '@/lib/date';
import { formatMoney } from '@/lib/money';

/** A range wide enough to cover every entry, for the all-time total. */
const ALL_TIME = { start: '0001-01-01', end: '9999-12-31' };

export default function CalendarScreen() {
  const router = useRouter();

  // The month on screen, and the day whose entries are shown beneath it.
  const [month, setMonth] = useState(() => monthStart(todayKey()));
  const [selected, setSelected] = useState(todayKey());

  const monthDays = useQuery(() => getDailyTotals(month, monthEnd(month)), [month]);
  const monthTotals = useQuery(() => getTotals(month, monthEnd(month)), [month]);
  const allTime = useQuery(() => getTotals(ALL_TIME.start, ALL_TIME.end));
  const entries = useQuery(() => getTransactionsByDay(selected), [selected]);

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
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.titleRow}>
            <ThemedText type="title" style={styles.title}>
              Calendar
            </ThemedText>
            {!isToday && (
              <Pressable onPress={jumpToToday} hitSlop={8}>
                <ThemedText type="smallBold" style={styles.jump}>
                  Today
                </ThemedText>
              </Pressable>
            )}
          </View>

          <MonthCalendar
            month={month}
            selected={selected}
            totals={monthDays}
            onSelect={setSelected}
            onChangeMonth={goMonth}
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
      </SafeAreaView>
      <AddButton
        label="Add Expense"
        href={{ pathname: '/entry', params: { day: selected } } as Href}
      />
    </ThemedView>
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
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.three,
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
    color: '#0B7C4F',
    paddingBottom: Spacing.two,
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
