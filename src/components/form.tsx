import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Children, Fragment, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { CalculatorSheet } from '@/components/calculator-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CURRENCY } from '@/constants/app';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatRelativeDay, todayKey } from '@/lib/date';
import { formatCompact, formatMoney, looksLikeExpression, parseAmount } from '@/lib/money';

/**
 * Building blocks for the add/edit screens (expense, loan, shared book), so
 * they all read as one kind of form: a big amount on top, then a card of
 * labelled rows, then one clear button.
 */

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

/**
 * What the quick-add chips step by.
 *
 * Chosen for the amounts this app actually sees — a chai, a lunch, a fare —
 * rather than round numbers for their own sake. They ADD rather than replace,
 * so three taps on +100 is 300 and nobody has to think about it.
 */
const AMOUNT_STEPS = [50, 100, 500, 1000];

/** The amount, large, with the currency coloured by direction. */
export function AmountField({
  value,
  onChangeText,
  color,
  autoFocus,
  editable = true,
  steps = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  color: string;
  autoFocus?: boolean;
  editable?: boolean;
  /** Pass false where a figure is being corrected rather than entered. */
  steps?: boolean;
}) {
  const theme = useTheme();
  const [padOpen, setPadOpen] = useState(false);

  /**
   * The sum, worked out, while it is still being written.
   *
   * `parseAmount` has always evaluated "120+80" on save; what it never did
   * was say so beforehand. Shown only for something that LOOKS like a sum, so
   * a plain amount is not followed around by a restatement of itself.
   */
  const working = looksLikeExpression(value) ? parseAmount(value) : null;

  /**
   * Add to the figure already there.
   *
   * Through `parseAmount`, so a half-typed sum like "120+80" settles to 200
   * before the step goes on — the alternative is a field holding "120+80+100",
   * which is correct and unreadable.
   */
  const bump = (step: number) => {
    const next = Math.round((parseAmount(value) + step) * 100) / 100;
    onChangeText(String(next));
  };

  return (
    <ThemedView type="backgroundElement" style={styles.amountCard}>
      <ThemedText type="small" themeColor="textSecondary">
        Amount
      </ThemedText>
      <View style={styles.amountRow}>
        <ThemedText style={[styles.currency, { color }]}>{CURRENCY.trim()}</ThemedText>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="0"
          placeholderTextColor={theme.textSecondary}
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          editable={editable}
          style={[styles.amountInput, { color: theme.text }]}
          accessibilityLabel="Amount"
        />
        {/* A decimal pad has no + − × ÷ on it, which is the only reason the
            sums this field can already evaluate were impossible to type. */}
        {editable && (
          <Pressable
            onPress={() => {
              // The system pad and this one both want the bottom of the
              // screen; the one with operators on it wins.
              Keyboard.dismiss();
              setPadOpen(true);
            }}
            hitSlop={8}
            style={({ pressed }) => [styles.calcBtn, theme.glassWeak, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Open the calculator">
            <MaterialIcons name="calculate" size={20} color={color} />
          </Pressable>
        )}
      </View>

      {working !== null && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.working}>
          = {formatMoney(working)}
        </ThemedText>
      )}

      {/* A numeric keypad has no Done key on Android, so these also give the
          thumb somewhere useful to be while the pad is up. */}
      {steps && editable && (
        <View style={styles.stepRow}>
          {AMOUNT_STEPS.map((step) => (
            <Pressable
              key={step}
              onPress={() => bump(step)}
              style={({ pressed }) => [styles.stepChip, theme.glassWeak, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Add ${step}`}>
              <ThemedText type="small" themeColor="textSecondary">
                +{formatCompact(step)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}

      <CalculatorSheet
        visible={padOpen}
        initial={value}
        color={color}
        onChange={onChangeText}
        onClose={() => setPadOpen(false)}
      />
    </ThemedView>
  );
}

/** A card of form rows with hairlines between them. */
export function FormCard({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  // toArray drops null / false, so conditional rows don't leave stray dividers.
  const rows = Children.toArray(children);
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />}
          {row}
        </Fragment>
      ))}
    </ThemedView>
  );
}

/** One labelled row: an icon, a small label, and the field or value under it. */
export function FormRow({
  icon,
  label,
  onPress,
  chevron,
  children,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  chevron?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const body = (
    <>
      <View style={[styles.rowIcon, theme.glassWeak]}>
        <MaterialIcons name={icon} size={20} color={theme.accent} />
      </View>
      <View style={styles.rowBody}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowLabel}>
          {label}
        </ThemedText>
        {children}
      </View>
      {chevron && <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}>
      {body}
    </Pressable>
  );
}

/** A borderless text field that sits inside a FormRow. */
export function FormInput(props: TextInputProps) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.textSecondary}
      {...props}
      style={[styles.input, { color: theme.text }, props.style]}
    />
  );
}

/** Day-at-a-time date picker for a FormRow; never moves past today. */
export function DateStepper({
  day,
  onChange,
  color,
}: {
  day: string;
  onChange: (day: string) => void;
  color: string;
}) {
  const theme = useTheme();
  const isToday = day >= todayKey();
  return (
    <View style={styles.dateRow}>
      <Pressable
        onPress={() => onChange(addDays(day, -1))}
        hitSlop={8}
        style={styles.dateBtn}
        accessibilityRole="button"
        accessibilityLabel="Previous day">
        <MaterialIcons name="chevron-left" size={24} color={theme.text} />
      </Pressable>
      <View style={styles.dateMiddle}>
        <ThemedText type="smallBold">{formatRelativeDay(day)}</ThemedText>
        {!isToday && (
          <Pressable onPress={() => onChange(todayKey())} hitSlop={6}>
            <ThemedText type="small" style={{ color }}>
              Jump to today
            </ThemedText>
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={() => !isToday && onChange(addDays(day, 1))}
        disabled={isToday}
        hitSlop={8}
        style={styles.dateBtn}
        accessibilityRole="button"
        accessibilityLabel="Next day">
        <MaterialIcons
          name="chevron-right"
          size={24}
          color={theme.text}
          style={isToday ? styles.dim : undefined}
        />
      </Pressable>
    </View>
  );
}

/** The form's one main action. */
export function PrimaryButton({
  label,
  onPress,
  color,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  color: string;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: color },
        disabled && styles.dim,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(busy || disabled) }}>
      {busy ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.primaryLabel}>{label}</ThemedText>}
    </Pressable>
  );
}

/** Secondary actions under the main button, e.g. Duplicate · Delete. */
export function FormLinks({ children }: { children: React.ReactNode }) {
  return <View style={styles.links}>{children}</View>;
}

export function FormLink({
  label,
  icon,
  color,
  onPress,
}: {
  label: string;
  icon: IconName;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      accessibilityRole="button">
      <MaterialIcons name={icon} size={18} color={color} />
      <ThemedText type="smallBold" style={{ color }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  amountCard: {
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  currency: {
    fontSize: 22,
    fontWeight: '700',
  },
  amountInput: {
    flex: 1,
    fontSize: 40,
    fontWeight: '700',
    paddingVertical: Spacing.one,
  },
  calcBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  working: {
    paddingTop: 2,
  },
  stepRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  stepChip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: Radius.full,
    paddingVertical: 6,
  },
  card: {
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
  },
  divider: {
    height: 1,
    marginLeft: 52,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 64,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  input: {
    fontSize: 16,
    paddingVertical: 2,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateMiddle: {
    flex: 1,
    alignItems: 'center',
  },
  primary: {
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryLabel: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  links: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.five,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  dim: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.7,
  },
});
