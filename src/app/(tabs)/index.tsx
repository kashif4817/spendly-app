import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BalanceCard } from '@/components/balance-card';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getLedgerTotals, getTotals, getTransactionsByDay } from '@/db';
import { useCategoryEmoji, useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { useWeekStart } from '@/hooks/use-week-start';
import {
  addDays,
  formatRelativeDay,
  monthEnd,
  monthStart,
  todayKey,
  weekEnd,
  weekStart,
} from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { setWeekStart } from '@/lib/week-start';
import { useSync } from '@/sync/provider';
import { TransactionRow } from '@/components/transaction-row';

export default function DashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { name, avatarUrl } = useSync();
  const emojiFor = useCategoryEmoji();

  const weekStartsOn = useWeekStart();

  const today = todayKey();
  const wkStart = weekStart(today, weekStartsOn);
  const lastWkStart = weekStart(addDays(wkStart, -1), weekStartsOn);

  const periods = [
    { key: 'today', label: 'Today', start: today, end: today },
    { key: 'yesterday', label: 'Yesterday', start: addDays(today, -1), end: addDays(today, -1) },
    { key: 'week', label: 'This week', start: wkStart, end: weekEnd(today, weekStartsOn) },
    { key: 'lastweek', label: 'Last week', start: lastWkStart, end: weekEnd(lastWkStart, weekStartsOn) },
    { key: 'month', label: 'This month', start: monthStart(today), end: monthEnd(today) },
    { key: 'all', label: 'All time', start: '0001-01-01', end: '9999-12-31' },
    { key: 'custom', label: 'Custom', start: today, end: today },
  ];

  const [periodKey, setPeriodKey] = useState('week');
  const [menuOpen, setMenuOpen] = useState(false);
  const [custom, setCustom] = useState({ start: wkStart, end: today });

  const preset = periods.find((p) => p.key === periodKey) ?? periods[2];
  const range = periodKey === 'custom' ? custom : { start: preset.start, end: preset.end };
  const periodLabel = periodKey === 'custom' ? 'Custom range' : preset.label;

  const totals = useQuery(() => getTotals(range.start, range.end), [range.start, range.end]);
  const ledger = useQuery(() => getLedgerTotals());
  // Today only — older entries live on the Expenses and Reports tabs.
  const recent = useQuery(() => getTransactionsByDay(today).slice(0, 5), [today]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (name ?? '').trim().split(' ')[0] || 'there';
  const initial = firstName.charAt(0).toUpperCase() || '?';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          {/* Greeting + avatar */}
          <View style={styles.topRow}>
            <View style={styles.greetWrap}>
              <ThemedText type="small" themeColor="textSecondary">
                {greeting},
              </ThemedText>
              <ThemedText type="title" style={styles.hello} numberOfLines={1}>
                {firstName}
              </ThemedText>
            </View>
            <Pressable onPress={() => router.push('/profile' as Href)}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarPh, { backgroundColor: theme.accent }]}>
                  <ThemedText style={styles.avatarInitial}>{initial}</ThemedText>
                </View>
              )}
            </Pressable>
          </View>

          {/* Period dropdown */}
          <Pressable
            onPress={() => setMenuOpen(true)}
            style={[styles.dropdown, { backgroundColor: theme.backgroundElement }]}>
            <MaterialIcons name="calendar-today" size={16} color={theme.textSecondary} />
            <ThemedText type="smallBold" style={styles.dropdownLabel}>
              {periodLabel}
            </ThemedText>
            <MaterialIcons name="expand-more" size={20} color={theme.textSecondary} />
          </Pressable>

          {/* Custom range steppers */}
          {periodKey === 'custom' && (
            <View style={styles.customRow}>
              <DateStepper
                label="From"
                value={custom.start}
                onChange={(d) => setCustom((c) => ({ start: d, end: d > c.end ? d : c.end }))}
              />
              <DateStepper
                label="To"
                value={custom.end}
                max={today}
                onChange={(d) => setCustom((c) => ({ start: d < c.start ? d : c.start, end: d }))}
              />
            </View>
          )}

          {/* Income / expense / net */}
          <BalanceCard label={periodLabel} totals={totals} />

          {/* Money with people */}
          <ThemedView type="backgroundElement" style={styles.peopleCard}>
            <View style={styles.peopleHead}>
              <ThemedText type="smallBold">Money with people</ThemedText>
              <Pressable onPress={() => router.navigate('/loans' as Href)} hitSlop={8}>
                <ThemedText type="small" style={{ color: theme.accent }}>
                  View all
                </ThemedText>
              </Pressable>
            </View>
            <View style={styles.peopleLegs}>
              <View style={styles.leg}>
                <ThemedText type="small" themeColor="textSecondary">
                  You’ll get
                </ThemedText>
                <ThemedText style={[styles.legValue, { color: MoneyColors.in }]}>
                  {formatMoney(ledger.receivable)}
                </ThemedText>
              </View>
              <View style={styles.leg}>
                <ThemedText type="small" themeColor="textSecondary">
                  You’ll pay
                </ThemedText>
                <ThemedText style={[styles.legValue, { color: MoneyColors.out }]}>
                  {formatMoney(ledger.payable)}
                </ThemedText>
              </View>
            </View>
          </ThemedView>

          {/* Today’s activity */}
          {recent.length > 0 && (
            <View style={styles.recent}>
              <View style={styles.recentHead}>
                <ThemedText type="smallBold">Today’s activity</ThemedText>
                <Pressable onPress={() => router.navigate('/reports' as Href)} hitSlop={8}>
                  <ThemedText type="small" style={{ color: theme.accent }}>
                    See all
                  </ThemedText>
                </Pressable>
              </View>
              {recent.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                  emoji={emojiFor(tx.category, tx.type)}
                  onPress={() => router.push({ pathname: '/entry', params: { id: tx.id } })}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Period menu */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <ThemedView style={styles.menu}>
            {periods.map((p) => {
              const active = p.key === periodKey;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => {
                    setPeriodKey(p.key);
                    setMenuOpen(false);
                  }}
                  style={styles.menuItem}>
                  <ThemedText type={active ? 'smallBold' : 'small'} style={active ? { color: theme.accent } : undefined}>
                    {p.label}
                  </ThemedText>
                  {active && <MaterialIcons name="check" size={18} color={theme.accent} />}
                </Pressable>
              );
            })}

            {/* Sets the boundaries "This week" / "Last week" above are cut on. */}
            <View style={[styles.menuDivider, { backgroundColor: theme.backgroundSelected }]} />
            <View style={styles.menuFooter}>
              <ThemedText type="small" themeColor="textSecondary">
                Week starts on
              </ThemedText>
              <Segmented
                options={[
                  { label: 'Monday', value: 'mon' },
                  { label: 'Sunday', value: 'sun' },
                ]}
                value={weekStartsOn === 1 ? 'mon' : 'sun'}
                onChange={(value) => setWeekStart(value === 'mon' ? 1 : 0)}
              />
            </View>
          </ThemedView>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

function DateStepper({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: string;
  max?: string;
  onChange: (day: string) => void;
}) {
  const theme = useTheme();
  const atMax = max ? value >= max : false;
  return (
    <View style={[styles.stepper, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.stepperLabel}>
        {label}
      </ThemedText>
      <View style={styles.stepperControls}>
        <Pressable onPress={() => onChange(addDays(value, -1))} hitSlop={8}>
          <ThemedText style={styles.stepperArrow}>‹</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={styles.stepperValue} numberOfLines={1}>
          {formatRelativeDay(value)}
        </ThemedText>
        <Pressable onPress={() => !atMax && onChange(addDays(value, 1))} hitSlop={8}>
          <ThemedText style={[styles.stepperArrow, atMax && { opacity: 0.3 }]}>›</ThemedText>
        </Pressable>
      </View>
    </View>
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
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.three,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  greetWrap: {
    flex: 1,
  },
  hello: {
    fontSize: 34,
    lineHeight: 40,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 999,
  },
  avatarPh: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  dropdownLabel: {
    minWidth: 80,
  },
  customRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  stepper: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: 2,
  },
  stepperLabel: {
    fontSize: 11,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperArrow: {
    fontSize: 22,
    fontWeight: '600',
    width: 24,
    textAlign: 'center',
  },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
  },
  peopleCard: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  peopleHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  peopleLegs: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  leg: {
    flex: 1,
    gap: 2,
  },
  legValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  recent: {
    gap: Spacing.one,
  },
  recentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  menu: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    paddingVertical: Spacing.two,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  menuDivider: {
    height: 1,
    marginTop: Spacing.two,
  },
  menuFooter: {
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
});
