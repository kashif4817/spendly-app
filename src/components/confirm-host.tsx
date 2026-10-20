/**
 * Renders whatever `confirm()` / `notify()` last asked for.
 *
 * Mounted once at the root. See lib/confirm.ts for why these stopped being
 * platform alerts.
 */

import { useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  dismissConfirm,
  getConfirmRequest,
  subscribeConfirm,
  type ConfirmRequest,
} from '@/lib/confirm';

export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, getConfirmRequest, getConfirmRequest);
  const theme = useTheme();

  if (!request) return null;

  // Clear the slot FIRST, then run the handler: a handler that asks its own
  // follow-up question (the second warning on a destructive delete) then opens
  // into an empty slot rather than racing the dialog it came from.
  const close = (handler?: () => void) => {
    dismissConfirm();
    handler?.();
  };

  const confirmColor = request.destructive ? theme.money.out : theme.accent;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => close(request.onCancel)}>
      <Pressable
        style={styles.backdrop}
        onPress={() => close(request.onCancel)}
        accessibilityLabel="Dismiss">
        {/* Swallows taps so pressing the dialog doesn't dismiss it. */}
        <Pressable onPress={() => {}} style={styles.cardWrap}>
          <View style={[styles.card, theme.glassOverlay]}>
            <ThemedText type="smallBold" style={styles.title}>
              {request.title}
            </ThemedText>

            {!!request.message && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
                {request.message}
              </ThemedText>
            )}

            <View style={styles.actions}>
              {request.cancelLabel !== null && (
                <DialogButton
                  label={request.cancelLabel}
                  color={theme.textSecondary}
                  surface={theme.glassWeak}
                  onPress={() => close(request.onCancel)}
                />
              )}
              <DialogButton
                label={request.confirmLabel}
                color="#ffffff"
                surface={{ backgroundColor: confirmColor, borderWidth: 1, borderColor: 'rgba(255,255,255,0.38)' }}
                onPress={() => close(request.onConfirm)}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DialogButton({
  label,
  color,
  surface,
  onPress,
}: {
  label: string;
  color: string;
  surface: object;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, surface, pressed && styles.pressed]}>
      <ThemedText type="smallBold" style={{ color }} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Re-exported so the root layout mounts one thing. */
export type { ConfirmRequest };

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Scrim,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 360,
  },
  card: {
    borderRadius: Radius.large,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  title: {
    fontSize: 19,
    lineHeight: 26,
  },
  message: {
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  button: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  pressed: {
    opacity: 0.82,
  },
});
