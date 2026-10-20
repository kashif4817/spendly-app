import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/constants/theme';

/** Floating "+ Add" button that opens a modal (the add-entry one by default). */
export function AddButton({ href = '/entry' as Href, label = 'Add' }: { href?: Href; label?: string }) {
  const theme = useTheme();
  const router = useRouter();
  // The glass tab bar is absolutely positioned, so it OVERLAYS the screen and
  // this button has to clear it. (While the bar was an ordinary flex child the
  // screen already ended above it, and adding this height floated the button
  // most of a bar up the screen — the bug that started all this.)
  const tabBarHeight = useBottomTabBarHeight();

  return (
    <Pressable
      onPress={() => router.push(href)}
      style={({ pressed }) => [
        styles.fab,
        {
          backgroundColor: theme.accent,
          bottom: tabBarHeight + Spacing.three,
        },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <MaterialIcons name="add" size={20} color="#ffffff" />
      <ThemedText style={styles.label}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    // Was a long, flat lozenge: too wide for its height and padded far past
    // what the label needs. Squarer proportions and a real minimum height.
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
    borderRadius: Radius.full,
    // Lit along the top edge like every other pane, so it belongs to the same
    // material even though it is the one solid, saturated thing on screen.
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
    boxShadow: [
      { offsetX: 0, offsetY: 10, blurRadius: 28, color: 'rgba(0,0,0,0.34)' },
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.45)', inset: true },
    ],
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  label: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
