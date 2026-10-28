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
 *
 * COVERING MONEY: only the BALANCE covers. The entries below it never do.
 *
 * They did at first, on the reasoning that anyone who can read the rows can add
 * them up. True, but it misses what the screen is for: you open a statement to
 * read the entries, and a page of masked rows is a page with nothing on it. The
 * figure at the top is the one someone glances over your shoulder and takes in
 * at once, so that is the one worth covering. Summing a statement by eye is a
 * different thing from reading it.
 *
 * So `scope` belongs to `StatementBalance` alone, as a required prop rather
 * than a context: the compiler then refuses a screen that forgot to say whose
 * balance it is drawing.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { BalanceEye } from '@/components/balance-eye';
import { PeekingEyes } from '@/components/peeking-eyes';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useBalanceToggle } from '@/hooks/use-balance-privacy';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay } from '@/lib/date';
import { formatMoney, formatSigned } from '@/lib/money';

/**
 * The pane a statement opens with: who owes whom, how much, and in what sense.
 * `status` is the line above the figure — a sync state, or nothing at all.
 *
 * Covered, the figure gives way to a pair of eyes and the card becomes one big
 * target. The caption stays: which way the money runs is not the secret, the
 * amount is — and a card with nothing on it but eyes loses the thread of what
 * you were looking at.
 */
export function StatementBalance({
  scope,
  caption,
  amount,
  term,
  color,
  status,
}: {
  /** Whose balance this is — `personScope(...)` or `bookScope(...)`. */
  scope: string;
  caption: string;
  amount: number;
  /** "Receivable" / "Payable", or null when settled. */
  term: string | null;
  color: string;
  status?: React.ReactNode;
}) {
  const { covered, needsPin, toggle } = useBalanceToggle(scope);

  return (
    <ThemedView type="backgroundElement" style={styles.balanceCard}>
      {status}

      {/* The eye rides the caption line rather than the card corner. On a
          shared book that corner belongs to the sync chip, and the two sat on
          top of each other. Laid out as three columns, not an absolute pin: an
          empty gutter opposite the button is what keeps the caption centred,
          and a long name truncates instead of running underneath it. */}
      <View style={styles.captionRow}>
        <View style={styles.peekGutter} />
        <ThemedText
          type="small"
          themeColor="textSecondary"
          numberOfLines={1}
          style={styles.caption}>
          {caption}
        </ThemedText>
        <BalanceEye scope={scope} />
      </View>

      {covered ? (
        <Pressable
          onPress={toggle}
          style={({ pressed }) => [styles.balanceBody, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Show balance">
          <PeekingEyes size={46} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.peekHint}>
            {needsPin ? 'Tap to show with your PIN' : 'Tap to show'}
          </ThemedText>
        </Pressable>
      ) : (
        <View style={styles.balanceBody}>
          <ThemedText style={[styles.balance, { color }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatMoney(Math.abs(amount))}
          </ThemedText>
          {!!term && (
            <ThemedText type="small" themeColor="textSecondary">
              {term}
            </ThemedText>
          )}
        </View>
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
 *
 * A row always shows its amount, whatever the balance above it is doing — see
 * the note at the top of this file.
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
  /**
   * The figure and the eyes share this block, and it holds the taller of the
   * two — otherwise the whole screen jumps a few pixels every time you cover
   * or uncover the balance.
   */
  balanceBody: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
    minHeight: 74,
    alignSelf: 'stretch',
  },
  balance: {
    fontSize: 42,
    fontWeight: '700',
    lineHeight: 50,
    letterSpacing: -0.5,
  },
  captionRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  caption: {
    flex: 1,
    textAlign: 'center',
  },
  /** Balances the button on the other side, so the caption sits dead centre. */
  peekGutter: {
    width: 32,
  },
  peekHint: {
    marginTop: Spacing.one,
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
