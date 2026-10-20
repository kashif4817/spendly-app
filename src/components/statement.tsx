/**
 * The statement layout, shared by a person's ledger and a shared book.
 *
 * The two screens answer the same question — what passed between us, and where
 * does that leave the balance — so they had no business looking different.
 * They did: one grouped its days into panes, the other left rows loose under a
 * bare date. Everything either screen draws below the balance now comes from
 * here, so they cannot drift apart again.
 *
 * A day is ONE pane: `StatementDay` opens it, `StatementRow`s continue it, and
 * the last row closes it. That is the same card-per-group shape the Reports
 * screen uses, which is the one people said read best.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay } from '@/lib/date';
import { formatMoney, formatSigned } from '@/lib/money';

/**
 * The pane a statement opens with: who owes whom, how much, and in what sense.
 * `status` is the line above the figure — a sync state, or nothing at all.
 */
export function StatementBalance({
  caption,
  amount,
  term,
  color,
  status,
}: {
  caption: string;
  amount: number;
  /** "Receivable" / "Payable", or null when settled. */
  term: string | null;
  color: string;
  status?: React.ReactNode;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.balanceCard}>
      {status}
      <ThemedText type="small" themeColor="textSecondary">
        {caption}
      </ThemedText>
      <ThemedText style={[styles.balance, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {formatMoney(Math.abs(amount))}
      </ThemedText>
      {!!term && (
        <ThemedText type="small" themeColor="textSecondary">
          {term}
        </ThemedText>
      )}
    </ThemedView>
  );
}

/** The row holding a statement's two direction buttons. */
export function StatementActions({ children }: { children: React.ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

/**
 * The quiet "bring this to zero" control.
 *
 * Deliberately not a third coloured button: settling is rare next to recording
 * what happened, and three loud controls in a row left nothing leading.
 */
export function SettleButton({
  label = 'Settle up',
  disabled,
  onPress,
}: {
  label?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      // Bare text, no pane and no icon: settling is rare next to recording
      // what happened, and a third decorated control left the row with
      // nothing leading.
      style={({ pressed }) => [
        styles.settleBtn,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

/** The "STATEMENT" label above the list. */
export function StatementHeading({ children = 'Statement' }: { children?: string }) {
  return (
    <ThemedText type="smallBold" themeColor="textSecondary" style={styles.heading}>
      {children.toUpperCase()}
    </ThemedText>
  );
}

/**
 * The line above a day's entries: the date, and what the day came to.
 *
 * Plain text on the page, NOT a pane — the same shape the Reports history
 * uses, so a day reads the same wherever you meet one. The net stays muted;
 * in the entries' own blue and rose it competed with them.
 */
export function StatementDay({
  day,
  net,
  first,
  showNet = true,
}: {
  day: string;
  net: number;
  /** The first day sits right under the heading, so it needs less room above. */
  first?: boolean;
  showNet?: boolean;
}) {
  return (
    <View style={[styles.day, first && styles.dayFirst]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {formatRelativeDay(day)}
      </ThemedText>
      {showNet && (
        <ThemedText type="small" themeColor="textSecondary">
          {formatSigned(net)}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * One entry, as its own card.
 *
 * Deliberately the same object as a Reports transaction row: icon well, title
 * over a subtitle, amount on the right. The statements used to group a day
 * into one continuous pane, which looked fine on its own but meant the app
 * had two different ways of drawing "a list of money things".
 *
 * `positive` is worked out per viewer by the caller: the same row is "you
 * paid" on one phone and "they paid" on the other.
 */
export function StatementRow({
  title,
  note,
  amount,
  positive,
  color,
  trailing,
  onPress,
}: {
  title: string;
  /** The note, or the time when there isn't one. */
  note: string;
  amount: number;
  positive: boolean;
  color: string;
  /** A small mark beside the title — e.g. "not synced yet". */
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, theme.glass, pressed && styles.pressed]}>
      {/* Which way the money actually moved: out of your hand, or into it. */}
      <View style={[styles.rowIcon, theme.glassWeak]}>
        <MaterialIcons
          name={positive ? 'call-made' : 'call-received'}
          size={18}
          color={color}
        />
      </View>

      <View style={styles.rowMiddle}>
        <View style={styles.rowTitle}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.rowTitleText}>
            {title}
          </ThemedText>
          {trailing}
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {note}
        </ThemedText>
      </View>

      <ThemedText type="smallBold" style={[styles.rowAmount, { color }]}>
        {positive ? '+' : '−'}
        {formatMoney(amount)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  balanceCard: {
    borderRadius: Radius.large,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.half,
    alignItems: 'center',
  },
  balance: {
    fontSize: 42,
    fontWeight: '700',
    lineHeight: 50,
    letterSpacing: -0.5,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  settleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 40,
  },
  heading: {
    marginTop: Spacing.two,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.half,
  },
  dayFirst: {
    paddingTop: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    marginBottom: 6,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMiddle: {
    flex: 1,
    gap: 1,
  },
  rowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  rowTitleText: {
    flexShrink: 1,
  },
  rowAmount: {
    fontSize: 15,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.4,
  },
});
