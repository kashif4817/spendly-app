import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MoneyColors } from '@/constants/app';
import { HeroCard, Spacing } from '@/constants/theme';
import type { Totals } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney, formatSigned } from '@/lib/money';

type Props = {
  label: string;
  totals: Totals;
  /**
   * 'hero' is the dashboard's mint card, identical in light and dark mode;
   * the default is a plain themed card.
   */
  tone?: 'default' | 'hero';
  /** Sits at the top right, e.g. the dashboard's period picker. */
  action?: React.ReactNode;
  /** Extra controls between the header and the figures (a custom date range). */
  children?: React.ReactNode;
};

/**
 * A period at a glance: money in and money out side by side, with the net
 * underneath. Deliberately compact — the figures are the point, not the card.
 */
export function BalanceCard({ label, totals, tone = 'default', action, children }: Props) {
  const theme = useTheme();
  const hero = tone === 'hero';
  const c = hero
    ? {
        background: HeroCard.background,
        inset: HeroCard.inset,
        divider: HeroCard.divider,
        text: HeroCard.text,
        secondary: HeroCard.textSecondary,
        in: HeroCard.in,
        out: HeroCard.out,
      }
    : {
        background: theme.backgroundElement,
        inset: theme.background,
        divider: theme.backgroundSelected,
        text: theme.text,
        secondary: theme.textSecondary,
        in: MoneyColors.in,
        out: MoneyColors.out,
      };

  const empty = totals.income === 0 && totals.expense === 0;
  const netColor = empty ? c.secondary : totals.net >= 0 ? c.in : c.out;
  const netCaption = empty ? 'No entries yet' : totals.net >= 0 ? 'saved' : 'overspent';

  return (
    <View style={[styles.card, { backgroundColor: c.background }]}>
      {hero && (
        // Two soft shapes so the mint card has some character without a gradient.
        <>
          <View pointerEvents="none" style={[styles.glow, { backgroundColor: HeroCard.glow }]} />
          <View pointerEvents="none" style={[styles.glowLow, { backgroundColor: HeroCard.glowTeal }]} />
        </>
      )}

      <View style={styles.head}>
        <ThemedText type="smallBold" style={[styles.label, { color: c.secondary }]} numberOfLines={1}>
          {label}
        </ThemedText>
        {action}
      </View>

      {children}

      <View style={styles.legs}>
        <Leg label="Money in" icon="call-received" color={c.in} text={c.text} secondary={c.secondary} amount={totals.income} />
        <View style={[styles.legDivider, { backgroundColor: c.divider }]} />
        <Leg label="Money out" icon="call-made" color={c.out} text={c.text} secondary={c.secondary} amount={totals.expense} />
      </View>

      <View style={[styles.netRow, { backgroundColor: c.inset }]}>
        <ThemedText type="small" style={{ color: c.secondary }}>
          Net
        </ThemedText>
        <View style={styles.netRight}>
          <ThemedText style={[styles.net, { color: netColor }]} numberOfLines={1}>
            {empty ? formatMoney(0) : formatSigned(totals.net)}
          </ThemedText>
          <ThemedText type="small" style={{ color: c.secondary }}>
            {netCaption}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

function Leg({
  label,
  icon,
  color,
  text,
  secondary,
  amount,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  color: string;
  text: string;
  secondary: string;
  amount: number;
}) {
  return (
    <View style={styles.leg}>
      <View style={styles.legHeader}>
        {/* The colour carries the direction; `1F` is ~12% alpha for the chip. */}
        <View style={[styles.legIcon, { backgroundColor: `${color}1F` }]}>
          <MaterialIcons name={icon} size={14} color={color} />
        </View>
        <ThemedText type="small" style={{ color: secondary }}>
          {label}
        </ThemedText>
      </View>
      <ThemedText style={[styles.legValue, { color: text }]} numberOfLines={1} adjustsFontSizeToFit>
        {formatMoney(amount)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.three,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: -60,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: 999,
  },
  glowLow: {
    position: 'absolute',
    bottom: -70,
    left: -50,
    width: 160,
    height: 160,
    borderRadius: 999,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    minHeight: 32,
  },
  label: {
    flex: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 12,
  },
  legs: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  leg: {
    flex: 1,
    gap: Spacing.one,
  },
  legDivider: {
    width: 1,
    marginHorizontal: Spacing.three,
  },
  legHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  legIcon: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legValue: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  netRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  netRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.one,
    flexShrink: 1,
  },
  net: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    flexShrink: 1,
  },
});
