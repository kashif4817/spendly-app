import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppUpdateButton } from '@/components/app-update-button';
import { BalanceCard } from '@/components/balance-card';
import { HBar } from '@/components/bar-chart';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, HeroCard, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  combineLedgerTotals,
  getCategoryBreakdown,
  getCurrentUserId,
  getLedgerTotals,
  getRecentTransactions,
  getSharedBookSummaries,
  getTotals,
} from '@/db';
import { useCategoryEmoji, useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { useWeekStart } from '@/hooks/use-week-start';
import {
  addDays,
  formatFullDate,
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

/** How many categories "Where it went" lists. */
const TOP_CATEGORIES = 3;

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
  const topSpend = useQuery(
    () => getCategoryBreakdown(range.start, range.end, 'out').slice(0, TOP_CATEGORIES),
    [range.start, range.end]
  );
  // Exactly what the Loans tab's headline shows: your own people plus shared books.
  const me = getCurrentUserId() ?? '';
  const ledger = useQuery(
    () => combineLedgerTotals(getLedgerTotals(), me ? getSharedBookSummaries(me) : []),
    [me]
  );
  // The latest entries of any date, so the dashboard stays useful all day.
  const recent = useQuery(() => getRecentTransactions(3));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (name ?? '').trim().split(' ')[0] || 'there';
  const initial = firstName.charAt(0).toUpperCase() || '?';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Greeting + avatar */}
          <View style={styles.topRow}>
            <View style={styles.greetWrap}>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {greeting} · {formatFullDate(today)}
              </ThemedText>
              <ThemedText type="title" style={styles.hello} numberOfLines={1}>
                {firstName}
              </ThemedText>
            </View>
            <View style={styles.topActions}>
              {/* Only there while a newer APK is waiting to be installed. */}
              <AppUpdateButton />
              <Pressable
                onPress={() => router.push('/profile' as Href)}
                accessibilityRole="button"
                accessibilityLabel="Profile">
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarPh, { backgroundColor: theme.accent }]}>
                    <ThemedText style={styles.avatarInitial}>{initial}</ThemedText>
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          {/* The period at a glance */}
          <BalanceCard
            label="Overview"
            tone="hero"
            totals={totals}
            action={
              <Pressable
                onPress={() => setMenuOpen(true)}
                style={({ pressed }) => [
                  styles.periodButton,
                  { backgroundColor: HeroCard.inset },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Change period, currently ${periodLabel}`}>
                <MaterialIcons name="calendar-today" size={14} color={HeroCard.in} />
                <ThemedText type="smallBold" style={[styles.periodButtonText, { color: HeroCard.text }]}>
                  {periodLabel}
                </ThemedText>
                <MaterialIcons name="expand-more" size={18} color={HeroCard.text} />
              </Pressable>
            }>
            {periodKey === 'custom' && (
              <View style={styles.customRow}>
                <DateStepper
                  label="From"
                  value={custom.start}
                  max={today}
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
          </BalanceCard>

          {/* Shortcuts to the main pages. Adding happens on those pages. */}
          <View style={styles.quickActions}>
            <QuickAction
              label="Expenses"
              icon="receipt-long"
              color={MoneyColors.out}
              onPress={() => router.navigate('/today' as Href)}
            />
            <QuickAction
              label="Income"
              icon="savings"
              color={MoneyColors.in}
              onPress={() =>
                // Reports, opened on the income breakdown.
                router.navigate({
                  pathname: '/reports',
                  params: { breakdown: 'in', at: String(Date.now()) },
                })
              }
            />
            <QuickAction
              label="Loans"
              icon="people-outline"
              color={theme.accent}
              onPress={() => router.navigate('/loans' as Href)}
            />
            <QuickAction
              label="Budgets"
              icon="account-balance-wallet"
              color={theme.accent}
              onPress={() => router.push('/budgets' as Href)}
            />
          </View>

          {/* Where the period's money went */}
          {topSpend.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <SectionHead
                title="Where it went"
                action="Reports"
                onPress={() => router.navigate('/reports' as Href)}
              />
              {topSpend.map((slice) => {
                const share = totals.expense > 0 ? Math.round((slice.total / totals.expense) * 100) : 0;
                return (
                  <View key={slice.category} style={styles.catRow}>
                    <View style={[styles.catIcon, { backgroundColor: theme.background }]}>
                      <ThemedText style={styles.catEmoji}>{emojiFor(slice.category, 'out')}</ThemedText>
                    </View>
                    <View style={styles.catBody}>
                      <View style={styles.catLine}>
                        <ThemedText type="smallBold" numberOfLines={1} style={styles.catName}>
                          {slice.category}
                        </ThemedText>
                        <ThemedText type="smallBold">{formatMoney(slice.total)}</ThemedText>
                      </View>
                      <View style={styles.catLine}>
                        <View style={styles.catBar}>
                          <HBar value={slice.total} max={totals.expense} color={theme.accent} />
                        </View>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.catShare}>
                          {share}%
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ThemedView>
          )}

          {/* Money with people */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <SectionHead
              title="Money with people"
              action="View all"
              onPress={() => router.navigate('/loans' as Href)}
            />
            <View style={styles.peopleLegs}>
              <View style={styles.leg}>
                <ThemedText type="small" themeColor="textSecondary">
                  You’ll get
                </ThemedText>
                <ThemedText style={[styles.legValue, { color: MoneyColors.in }]} numberOfLines={1} adjustsFontSizeToFit>
                  {formatMoney(ledger.receivable)}
                </ThemedText>
              </View>
              <View style={[styles.legDivider, { backgroundColor: theme.backgroundSelected }]} />
              <View style={styles.leg}>
                <ThemedText type="small" themeColor="textSecondary">
                  You’ll pay
                </ThemedText>
                <ThemedText style={[styles.legValue, { color: MoneyColors.out }]} numberOfLines={1} adjustsFontSizeToFit>
                  {formatMoney(ledger.payable)}
                </ThemedText>
              </View>
            </View>
          </ThemedView>

          {/* Most recent entries */}
          {recent.length > 0 && (
            <View style={styles.recent}>
              <SectionHead
                title="Recent activity"
                action="View all"
                onPress={() => router.navigate('/reports' as Href)}
              />
              {recent.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                  emoji={emojiFor(tx.category, tx.type)}
                  showDateAndTime
                  onPress={() => router.push({ pathname: '/transaction', params: { id: tx.id } })}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Period menu */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          {/* Swallows taps so pressing inside the menu doesn't close it. */}
          <Pressable onPress={() => {}} style={styles.menuWrap}>
            <ThemedView type="backgroundElement" style={styles.menu}>
              {periods.map((p) => {
                const active = p.key === periodKey;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => {
                      setPeriodKey(p.key);
                      setMenuOpen(false);
                    }}
                    style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}>
                    <ThemedText
                      type={active ? 'smallBold' : 'small'}
                      style={active ? { color: theme.accent } : undefined}>
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
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

function SectionHead({ title, action, onPress }: { title: string; action: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHead}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
        <ThemedText type="smallBold" style={{ color: theme.accent }}>
          {action}
        </ThemedText>
      </Pressable>
    </View>
  );
}

function QuickAction({
  label,
  icon,
  color,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  color: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quickAction, pressed && styles.quickActionPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <View style={[styles.quickActionTile, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.quickActionIcon, { backgroundColor: `${color}1A` }]}>
          <MaterialIcons name={icon} size={24} color={color} />
        </View>
      </View>
      <ThemedText type="small" style={styles.quickActionLabel} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Custom-range stepper. It sits on the mint card, so it uses the card's colours. */
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
  const atMax = max ? value >= max : false;
  return (
    <View style={[styles.stepper, { backgroundColor: HeroCard.inset }]}>
      <ThemedText type="small" style={[styles.stepperLabel, { color: HeroCard.textSecondary }]}>
        {label}
      </ThemedText>
      <View style={styles.stepperControls}>
        <Pressable onPress={() => onChange(addDays(value, -1))} hitSlop={8}>
          <ThemedText style={[styles.stepperArrow, { color: HeroCard.text }]}>‹</ThemedText>
        </Pressable>
        <ThemedText
          type="smallBold"
          style={[styles.stepperValue, { color: HeroCard.text }]}
          numberOfLines={1}>
          {formatRelativeDay(value)}
        </ThemedText>
        <Pressable onPress={() => !atMax && onChange(addDays(value, 1))} hitSlop={8}>
          <ThemedText style={[styles.stepperArrow, { color: HeroCard.text }, atMax && styles.dim]}>
            ›
          </ThemedText>
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
    gap: Spacing.three,
  },
  greetWrap: {
    flex: 1,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  hello: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
  },
  avatarPh: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  periodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 999,
  },
  periodButtonText: {
    fontSize: 12,
    lineHeight: 16,
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
  quickActions: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.two,
  },
  quickActionPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }],
  },
  quickActionTile: {
    width: '100%',
    aspectRatio: 1,
    maxWidth: 76,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  card: {
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  catIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catEmoji: {
    fontSize: 20,
    lineHeight: 26,
  },
  catBody: {
    flex: 1,
    gap: 6,
  },
  catLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  catName: {
    flex: 1,
  },
  catBar: {
    flex: 1,
  },
  catShare: {
    fontSize: 12,
    minWidth: 32,
    textAlign: 'right',
  },
  peopleLegs: {
    flexDirection: 'row',
  },
  leg: {
    flex: 1,
    gap: 2,
  },
  legDivider: {
    width: 1,
    marginHorizontal: Spacing.three,
  },
  legValue: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  recent: {
    gap: Spacing.one,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  menuWrap: {
    width: '100%',
    maxWidth: 320,
  },
  menu: {
    borderRadius: 20,
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
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
  dim: {
    opacity: 0.3,
  },
});
