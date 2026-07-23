import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HBar, VerticalBars } from '@/components/bar-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getCategoryBreakdown, getMonthlyTotals, getReportStats, getTopTransactions } from '@/db';
import { useCategoryEmoji, useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import {
  addMonths,
  formatRelativeDay,
  monthEnd,
  monthShort,
  monthStart,
  todayKey,
  yearEnd,
  yearStart,
} from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { exportReportPdf } from '@/lib/export';

const CAT_LIMIT = 8;

export default function AdvancedReportScreen() {
  const theme = useTheme();
  const emojiFor = useCategoryEmoji();
  const today = todayKey();

  const ranges = [
    { key: 'month', label: 'This month', start: monthStart(today), end: monthEnd(today) },
    {
      key: 'last',
      label: 'Last month',
      start: monthStart(addMonths(today, -1)),
      end: monthEnd(addMonths(today, -1)),
    },
    { key: '3m', label: '3 months', start: monthStart(addMonths(today, -2)), end: monthEnd(today) },
    { key: '6m', label: '6 months', start: monthStart(addMonths(today, -5)), end: monthEnd(today) },
    { key: 'year', label: 'This year', start: yearStart(today), end: yearEnd(today) },
    { key: 'all', label: 'All time', start: '0001-01-01', end: '9999-12-31' },
  ];

  const [rangeKey, setRangeKey] = useState('month');
  const [exporting, setExporting] = useState(false);
  const range = ranges.find((r) => r.key === rangeKey) ?? ranges[0];

  const stats = useQuery(() => getReportStats(range.start, range.end), [range.start, range.end]);
  const months = useQuery(() => getMonthlyTotals(range.start, range.end), [range.start, range.end]);
  const cats = useQuery(
    () => getCategoryBreakdown(range.start, range.end, 'out'),
    [range.start, range.end]
  );
  const top = useQuery(
    () => getTopTransactions(range.start, range.end, 'out', 5),
    [range.start, range.end]
  );

  const savings = stats.income > 0 ? `${Math.round((stats.net / stats.income) * 100)}%` : '—';
  const catMax = cats.length ? cats[0].total : 1;
  const monthBars = months.slice(-12).map((m) => ({ label: monthShort(m.month), value: m.expense }));

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await exportReportPdf(range.start, range.end, range.label);
      if (res === 'empty') Alert.alert('Nothing to export', 'No activity in this range.');
      else if (res === 'unavailable')
        Alert.alert('Unavailable', 'Sharing isn’t available on this device.');
    } catch {
      Alert.alert('Export failed', 'Something went wrong creating the PDF.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Range selector */}
          <View style={styles.ranges}>
            {ranges.map((r) => {
              const active = r.key === rangeKey;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setRangeKey(r.key)}
                  style={[
                    styles.rangeChip,
                    { backgroundColor: active ? theme.text : theme.backgroundElement },
                  ]}>
                  <ThemedText
                    type="small"
                    style={{ color: active ? theme.background : theme.text }}>
                    {r.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {stats.count === 0 ? (
            <View style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>📊</ThemedText>
              <ThemedText type="smallBold">No activity in this range</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Pick another range or add some entries.
              </ThemedText>
            </View>
          ) : (
            <>
              {/* KPI grid */}
              <View style={styles.tiles}>
                <Tile label="Income" value={formatMoney(stats.income)} color={MoneyColors.in} />
                <Tile label="Expense" value={formatMoney(stats.expense)} color={MoneyColors.out} />
                <Tile label="Net" value={formatMoney(stats.net)} />
                <Tile label="Savings rate" value={savings} />
                <Tile label="Avg / spend day" value={formatMoney(stats.avgPerDay)} />
                <Tile label="Entries" value={String(stats.count)} />
              </View>

              {/* Monthly trend */}
              {monthBars.length > 1 && (
                <ThemedView type="backgroundElement" style={styles.card}>
                  <ThemedText type="smallBold" style={styles.cardTitle}>
                    Monthly spending
                  </ThemedText>
                  <VerticalBars data={monthBars} color={MoneyColors.out} />
                </ThemedView>
              )}

              {/* Category breakdown */}
              {cats.length > 0 && (
                <View style={styles.section}>
                  <ThemedText type="smallBold">Where it went</ThemedText>
                  <View style={styles.slices}>
                    {cats.slice(0, CAT_LIMIT).map((c) => {
                      const pct = stats.expense > 0 ? Math.round((c.total / stats.expense) * 100) : 0;
                      return (
                        <View key={c.category} style={styles.slice}>
                          <View style={styles.sliceTop}>
                            <ThemedText type="small" style={styles.sliceLabel} numberOfLines={1}>
                              {emojiFor(c.category, 'out')}  {c.category}
                            </ThemedText>
                            <ThemedText type="smallBold">
                              {formatMoney(c.total)}{' '}
                              <ThemedText type="small" themeColor="textSecondary">
                                · {pct}%
                              </ThemedText>
                            </ThemedText>
                          </View>
                          <HBar value={c.total} max={catMax} color={MoneyColors.out} />
                        </View>
                      );
                    })}
                    {cats.length > CAT_LIMIT && (
                      <ThemedText type="small" themeColor="textSecondary">
                        + {cats.length - CAT_LIMIT} more categories
                      </ThemedText>
                    )}
                  </View>
                </View>
              )}

              {/* Biggest expenses */}
              {top.length > 0 && (
                <View style={styles.section}>
                  <ThemedText type="smallBold">Biggest expenses</ThemedText>
                  <View style={styles.topList}>
                    {top.map((t) => (
                      <View key={t.id} style={styles.topRow}>
                        <ThemedText style={styles.topEmoji}>{emojiFor(t.category, 'out')}</ThemedText>
                        <View style={styles.topMiddle}>
                          <ThemedText type="smallBold" numberOfLines={1}>
                            {t.note?.trim() || t.category}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {t.category} · {formatRelativeDay(t.day)}
                          </ThemedText>
                        </View>
                        <ThemedText type="smallBold" style={{ color: MoneyColors.out }}>
                          {formatMoney(t.amount)}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Export */}
              <Pressable
                onPress={onExport}
                disabled={exporting}
                style={({ pressed }) => [styles.exportBtn, pressed && styles.pressed]}>
                {exporting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText style={styles.exportLabel}>Export this report (PDF)</ThemedText>
                )}
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText style={[styles.tileValue, color ? { color } : null]}>{value}</ThemedText>
    </View>
  );
}

const ACCENT = '#0B7C4F';

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
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  ranges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  rangeChip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: 2,
  },
  tileValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  cardTitle: {
    marginBottom: Spacing.one,
  },
  section: {
    gap: Spacing.three,
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
  topList: {
    gap: Spacing.two,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  topEmoji: {
    fontSize: 20,
  },
  topMiddle: {
    flex: 1,
    gap: 1,
  },
  exportBtn: {
    marginTop: Spacing.two,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  exportLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
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
