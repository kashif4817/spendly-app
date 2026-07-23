import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const DANGER = '#e5484d';
const ACCENT = '#0B7C4F';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Colour the confirm button red (for sign-out, delete, etc.). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A small centered confirmation dialog with a dimmed backdrop and scale-in. */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 8, tension: 90, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]).start();
    } else {
      scale.setValue(0.92);
      opacity.setValue(0);
    }
  }, [visible, scale, opacity]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        {/* Inner Pressable swallows taps so pressing the card doesn't dismiss. */}
        <Pressable onPress={() => {}}>
          <Animated.View
            style={[styles.card, { backgroundColor: theme.background, opacity, transform: [{ scale }] }]}>
            <ThemedText type="subtitle" style={styles.title}>
              {title}
            </ThemedText>
            {message && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
                {message}
              </ThemedText>
            )}

            <View style={styles.actions}>
              <Pressable
                onPress={onCancel}
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: theme.backgroundElement },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button">
                <ThemedText type="smallBold">{cancelLabel}</ThemedText>
              </Pressable>
              <Pressable
                onPress={onConfirm}
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: destructive ? DANGER : ACCENT },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button">
                <ThemedText type="smallBold" style={styles.confirmLabel}>
                  {confirmLabel}
                </ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
  },
  message: {
    marginBottom: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  confirmLabel: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.85,
  },
});
