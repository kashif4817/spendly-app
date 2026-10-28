import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet } from 'react-native';

import { Radius } from '@/constants/theme';
import { useBalanceToggle } from '@/hooks/use-balance-privacy';
import { useTheme } from '@/hooks/use-theme';

/**
 * The one control that covers and uncovers a figure.
 *
 * Every balance in the app is covered the same way, so the button is one
 * component rather than three near-identical copies: the statement card, the
 * two Loans totals and the dashboard's pair all mount this. That also means
 * the PIN rule can only ever be implemented once — `useBalanceToggle` owns it,
 * and no caller is in a position to get it wrong.
 *
 * `size` is the only thing that varies. Full size on a balance card; the small
 * one rides the label line of a summary tile, where a 32dp button would be
 * taller than the label beside it.
 */
export function BalanceEye({
  scope,
  size = 32,
  /** Named in the accessibility label, e.g. "Hide what you'll get". */
  what = 'balance',
}: {
  scope: string;
  size?: number;
  what?: string;
}) {
  const theme = useTheme();
  const { covered, toggle } = useBalanceToggle(scope);

  return (
    <Pressable
      onPress={toggle}
      hitSlop={10}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size },
        theme.glassWeak,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${covered ? 'Show' : 'Hide'} ${what}`}>
      <MaterialIcons
        name={covered ? 'visibility' : 'visibility-off'}
        size={Math.round(size * 0.53)}
        color={theme.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
});
