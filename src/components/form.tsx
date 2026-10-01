import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Children, Fragment } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CURRENCY } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatRelativeDay, todayKey } from '@/lib/date';

/**
 * Building blocks for the add/edit screens (expense, loan, shared book), so
 * they all read as one kind of form: a big amount on top, then a card of
 * labelled rows, then one clear button.
 */

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

/** The amount, large, with the currency coloured by direction. */
export function AmountField({
  value,
  onChangeText,
  color,
  autoFocus,
  editable = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  color: string;
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const theme = useTheme();
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
      </View>
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
      <View style={[styles.rowIcon, { backgroundColor: theme.background }]}>
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
    borderRadius: 20,
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
  card: {
    borderRadius: 20,
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
    borderRadius: 14,
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
