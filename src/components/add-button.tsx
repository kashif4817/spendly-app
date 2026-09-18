import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useRouter, type Href } from 'expo-router';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

/** Floating "+ Add" button that opens a modal (the add-entry one by default). */
export function AddButton({ href = '/entry' as Href, label = 'Add' }: { href?: Href; label?: string }) {
  const theme = useTheme();
  const router = useRouter();
  // Sit just above the actual tab bar (its height varies with the device's
  // navigation-bar / safe-area inset), so the button never floats or overlaps.
  const tabBarHeight = useBottomTabBarHeight();
  return (
    <Pressable
      onPress={() => router.push(href)}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: theme.accent },
        { bottom: tabBarHeight + Spacing.three },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <ThemedText style={styles.plus}>＋</ThemedText>
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
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  plus: {
    color: '#ffffff',
    fontSize: 22,
    lineHeight: Platform.select({ ios: 26, default: 24 }),
    fontWeight: '600',
    marginTop: Platform.select({ android: -2, default: 0 }),
  },
  label: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
