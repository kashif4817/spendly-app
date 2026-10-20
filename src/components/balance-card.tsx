import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlassView } from '@/components/glass';
import { Radius, Spacing } from '@/constants/theme';
import type { Totals } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney, formatSigned } from '@/lib/money';

type Props = {
  label: string;
  totals: Totals;
  /**
   * 'hero' is the dashboard's accent-tinted pane; the default is ordinary
   * glass. Both let the mesh through — the hero just pushes the accent
   * into it so the card a screen is built around reads as the subject.
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
  // Both tones now take their ink from the theme: a translucent pane follows
  // whatever is behind it, so fixed text colours (which the old solid card could
  // get away with) would fail in one theme or the other.
  const c = {
    inset: hero ? theme.hero.inset : theme.glassWeak.backgroundColor as string,
    divider: hero ? theme.hero.divider : theme.backgroundSelected,
    text: theme.text,
    secondary: theme.textSecondary,
    in: theme.moneyText.in,
    out: theme.moneyText.out,
  };

  const empty = totals.income === 0 && totals.expense === 0;
  const netColor = empty ? c.secondary : totals.net >= 0 ? c.in : c.out;
  const netCaption = empty ? 'No entries yet' : totals.net >= 0 ? 'saved' : 'overspent';

  return (
    <GlassView style={[styles.card, hero && theme.hero.tint]} radius={Radius.large}>
      {/* No decorative blobs: clipped to the corners they read as two stray
          half-circles, and the mesh already gives the pane its depth. */}

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
    </GlassView>
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
    padding: Spacing.three,
    gap: Spacing.three,
    overflow: 'hidden',
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
    borderRadius: Radius.small,
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
