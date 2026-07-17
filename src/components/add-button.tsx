import { useRouter, type Href } from 'expo-router';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';

/** Floating "+ Add" button that opens a modal (the add-entry one by default). */
export function AddButton({ href = '/entry' as Href, label = 'Add' }: { href?: Href; label?: string }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
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
    bottom: BottomTabInset + Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    backgroundColor: '#208AEF',
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
