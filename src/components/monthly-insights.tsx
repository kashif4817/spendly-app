import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import { getCategoryBreakdown, getDailyTotals, getTotals } from '@/db';
import { useCategoryEmoji, useQuery } from '@/db/hooks';
import { addDays, formatMonth, formatRelativeDay, monthEnd, monthStart, todayKey } from '@/lib/date';
import { formatMoney } from '@/lib/money';

/** A short, plain-English read on this month's spending vs last month. */
export function MonthlyInsights() {
  const emojiFor = useCategoryEmoji();
  const today = todayKey();

  const thisStart = monthStart(today);
  const thisEnd = monthEnd(today);
  const prevAnchor = addDays(thisStart, -1); // last day of previous month
  const prevStart = monthStart(prevAnchor);
  const prevEnd = monthEnd(prevAnchor);

  const thisTotals = useQuery(() => getTotals(thisStart, thisEnd), [thisStart, thisEnd]);
  const lastTotals = useQuery(() => getTotals(prevStart, prevEnd), [prevStart, prevEnd]);
  const thisCats = useQuery(() => getCategoryBreakdown(thisStart, thisEnd, 'out'), [thisStart, thisEnd]);
  const lastCats = useQuery(() => getCategoryBreakdown(prevStart, prevEnd, 'out'), [prevStart, prevEnd]);
  const daily = useQuery(() => getDailyTotals(thisStart, thisEnd), [thisStart, thisEnd]);

  const insight = useMemo(() => {
    const thisExp = thisTotals.expense;
    const lastExp = lastTotals.expense;
    const overallPct = lastExp > 0 ? ((thisExp - lastExp) / lastExp) * 100 : null;

    const topCat = thisCats[0] ?? null;
    const lastTopCat = topCat ? lastCats.find((c) => c.category === topCat.category)?.total ?? 0 : 0;
    const catPct = topCat && lastTopCat > 0 ? ((topCat.total - lastTopCat) / lastTopCat) * 100 : null;

    const biggestDay = daily.reduce<{ day: string; expense: number } | null>(
      (max, d) => (d.expense > (max?.expense ?? 0) ? { day: d.day, expense: d.expense } : max),
      null
    );

    return { thisExp, lastExp, overallPct, topCat, catPct, biggestDay };
  }, [thisTotals, lastTotals, thisCats, lastCats, daily]);

  const { thisExp, lastExp, overallPct, topCat, catPct, biggestDay } = insight;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.header}>
        INSIGHTS · {formatMonth(today).toUpperCase()}
      </ThemedText>

      {thisExp === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No spending recorded this month yet. Add a few entries and insights will show up here.
        </ThemedText>
      ) : (
        <View style={styles.rows}>
          <Row icon="account-balance-wallet">
            You’ve spent <B>{formatMoney(thisExp)}</B> this month.{' '}
            {overallPct === null ? (
              lastExp === 0 ? (
                'No spending last month to compare.'
              ) : null
            ) : (
              <Trend pct={overallPct} suffix=" than last month" />
            )}
          </Row>

          {topCat && (
            <Row icon="local-offer">
              <B>
                {emojiFor(topCat.category, 'out')} {topCat.category}
              </B>{' '}
              is your top category — <B>{formatMoney(topCat.total)}</B>.
              {catPct !== null ? <Trend pct={catPct} suffix=" vs last month" /> : null}
            </Row>
          )}

          {biggestDay && biggestDay.expense > 0 && (
            <Row icon="event">
              Biggest spending day was <B>{formatRelativeDay(biggestDay.day)}</B> at{' '}
              <B>{formatMoney(biggestDay.expense)}</B>.
            </Row>
          )}
        </View>
      )}
    </ThemedView>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <ThemedText type="smallBold">{children}</ThemedText>;
}

/** " X% more/less" coloured by direction (more spending = red). */
function Trend({ pct, suffix }: { pct: number; suffix: string }) {
  const up = pct >= 0;
  const rounded = Math.round(Math.abs(pct));
  if (rounded === 0) return <ThemedText type="small">About the same as last month.</ThemedText>;
  const color = up ? MoneyColors.out : MoneyColors.in;
  return (
    <ThemedText type="small">
      That’s <ThemedText type="smallBold" style={{ color }}>{rounded}% {up ? 'more' : 'less'}</ThemedText>
      {suffix}.
    </ThemedText>
  );
}

function Row({ icon, children }: { icon: keyof typeof MaterialIcons.glyphMap; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <MaterialIcons name={icon} size={18} color="#0B7C4F" style={styles.rowIcon} />
      <ThemedText type="small" style={styles.rowText}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    letterSpacing: 0.6,
  },
  rows: {
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  rowIcon: {
    marginTop: 2,
  },
  rowText: {
    flex: 1,
    lineHeight: 21,
  },
});
