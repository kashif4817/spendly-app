import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const DANGER = '#e5484d';

export type SheetAction = {
  label: string;
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  /** Colour the row red (delete, remove, etc.). */
  destructive?: boolean;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  title?: string;
  actions: SheetAction[];
  /**
   * Anything that belongs above the choices rather than among them — the
   * chat's row of tap-backs, say. A row of one-tap targets is not a list of
   * labelled actions, and forcing it into one would mean six near-identical
   * rows where a single strip reads better.
   */
  header?: React.ReactNode;
  cancelLabel?: string;
  onClose: () => void;
};

/**
 * A themed bottom sheet of choices.
 *
 * Preferred over `Alert.alert` for pickers: Android's alert renders at most
 * three buttons and silently drops the rest (which can swallow "Cancel" and
 * strand the user), it ignores the app's dark theme, and it isn't dismissable
 * unless `cancelable` is passed. This sheet takes any number of actions, always
 * shows Cancel, and closes on backdrop tap or hardware back.
 */
export function ActionSheet({
  visible,
  title,
  actions,
  header,
  cancelLabel = 'Cancel',
  onClose,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const slide = useRef(new Animated.Value(24)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slide, { toValue: 0, friction: 9, tension: 80, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]).start();
    } else {
      slide.setValue(24);
      opacity.setValue(0);
    }
  }, [visible, slide, opacity]);

  /**
   * Dismiss first, then run the action on the next frame — opening the camera
   * or gallery while the sheet is still mounted can strand the native picker
   * behind the modal on Android.
   */
  const run = (action: SheetAction) => {
    onClose();
    requestAnimationFrame(action.onPress);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        {/* Swallows taps so pressing the sheet itself doesn't close it. */}
        <Pressable onPress={() => {}} style={styles.sheetWrap}>
          <Animated.View
            style={[
              styles.sheet,
              {
                ...theme.glassOverlay,
                paddingBottom: insets.bottom + Spacing.three,
                opacity,
                transform: [{ translateY: slide }],
              },
            ]}>
            <View style={[styles.grabber, { backgroundColor: theme.backgroundSelected }]} />

            {title && (
              <ThemedText type="smallBold" style={styles.title}>
                {title}
              </ThemedText>
            )}

            {header}

            {/* The cap lives on the part that scrolls, not on the sheet, so
                the sheet still sizes itself from its content — the same shape
                the entry picker settled on. A chat message can offer eight
                things to do with it, which is more than a short phone fits. */}
            <ScrollView
              style={{ maxHeight: Math.round(height * 0.48) }}
              showsVerticalScrollIndicator={false}
              bounces={false}>
              {actions.map((action) => (
              <Pressable
                key={action.label}
                onPress={() => run(action)}
                style={({ pressed }) => [
                  styles.row,
                  theme.glass,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button">
                {action.icon && (
                  <MaterialIcons
                    name={action.icon}
                    size={20}
                    color={action.destructive ? DANGER : theme.text}
                  />
                )}
                <ThemedText
                  type="smallBold"
                  style={action.destructive ? { color: DANGER } : undefined}>
                  {action.label}
                </ThemedText>
              </Pressable>
              ))}
            </ScrollView>

            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
              accessibilityRole="button">
              <ThemedText type="smallBold" themeColor="textSecondary">
                {cancelLabel}
              </ThemedText>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Scrim,
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    width: '100%',
  },
  sheet: {
    borderTopLeftRadius: Radius.large,
    borderTopRightRadius: Radius.large,
    borderBottomWidth: 0,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: Spacing.two,
  },
  title: {
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
  },
  cancel: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    minHeight: 48,
    marginTop: Spacing.one,
  },
  pressed: {
    opacity: 0.7,
  },
});
