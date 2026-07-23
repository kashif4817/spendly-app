import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PIN_LENGTH } from '@/lock/app-lock';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ACCENT = '#0B7C4F';
const DANGER = '#e5484d';

type Props = {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  error?: boolean;
  /** Show a biometric key in the bottom-left slot. */
  onBiometric?: () => void;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** A numeric PIN entry: filled dots + a 10-key pad with optional biometric key. */
export function PinPad({ value, onChange, onComplete, length = PIN_LENGTH, error, onBiometric }: Props) {
  const theme = useTheme();

  const press = (digit: string) => {
    if (value.length >= length) return;
    const next = value + digit;
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  const backspace = () => onChange(value.slice(0, -1));

  return (
    <View style={styles.wrap}>
      <View style={styles.dots}>
        {Array.from({ length }).map((_, i) => {
          const filled = i < value.length;
          return (
            <View
              key={i}
              style={[
                styles.dot,
                { borderColor: error ? DANGER : theme.textSecondary },
                filled && { backgroundColor: error ? DANGER : ACCENT, borderColor: error ? DANGER : ACCENT },
              ]}
            />
          );
        })}
      </View>

      <View style={styles.pad}>
        {KEYS.map((k) => (
          <Pressable
            key={k}
            onPress={() => press(k)}
            style={({ pressed }) => [styles.key, pressed && { backgroundColor: theme.backgroundElement }]}
            accessibilityRole="button">
            <ThemedText style={styles.keyText}>{k}</ThemedText>
          </Pressable>
        ))}

        {/* bottom-left: biometric or empty */}
        {onBiometric ? (
          <Pressable
            onPress={onBiometric}
            style={({ pressed }) => [styles.key, pressed && { backgroundColor: theme.backgroundElement }]}
            accessibilityRole="button"
            accessibilityLabel="Unlock with biometrics">
            <MaterialIcons name="fingerprint" size={30} color={ACCENT} />
          </Pressable>
        ) : (
          <View style={styles.key} />
        )}

        <Pressable
          onPress={() => press('0')}
          style={({ pressed }) => [styles.key, pressed && { backgroundColor: theme.backgroundElement }]}
          accessibilityRole="button">
          <ThemedText style={styles.keyText}>0</ThemedText>
        </Pressable>

        <Pressable
          onPress={backspace}
          style={({ pressed }) => [styles.key, pressed && { backgroundColor: theme.backgroundElement }]}
          accessibilityRole="button"
          accessibilityLabel="Delete">
          <MaterialIcons name="backspace" size={24} color={theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const KEY_SIZE = 72;

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: Spacing.five,
  },
  dots: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 2,
  },
  pad: {
    width: KEY_SIZE * 3 + Spacing.three * 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: Spacing.three,
  },
  key: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    fontSize: 28,
    fontWeight: '600',
  },
});
