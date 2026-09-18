import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const DANGER = '#e5484d';
type Props = {
  visible: boolean;
  title: string;
  message?: string;
  /** Text the field starts with — e.g. the current name when renaming. */
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Called with the typed text. Throw (or return a string) to keep the dialog
   * open and show the reason under the field — that's how a duplicate name is
   * reported without the user losing what they typed.
   */
  onSubmit: (value: string) => string | void;
  onCancel: () => void;
};

/**
 * A one-field dialog: ask for a name, get it back validated.
 *
 * `Alert.prompt` only exists on iOS, so this is the cross-platform stand-in —
 * themed like the rest of the app and able to report an error in place.
 */
export function PromptModal({
  visible,
  title,
  message,
  initialValue = '',
  placeholder,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  onSubmit,
  onCancel,
}: Props) {
  const theme = useTheme();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  // Each opening starts fresh: the previous name and any stale error would
  // otherwise still be sitting there.
  useEffect(() => {
    if (!visible) {
      scale.setValue(0.92);
      opacity.setValue(0);
      return;
    }
    setValue(initialValue);
    setError(null);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 8, tension: 90, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();
    // `initialValue` is read only when the dialog opens, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, scale, opacity]);

  const submit = () => {
    const problem = onSubmit(value);
    if (typeof problem === 'string') setError(problem);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}>
      {/* The keyboard-avoider wraps the backdrop rather than sitting inside it,
          so the card still measures against a full-width parent. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onCancel}>
          {/* Inner Pressable swallows taps so pressing the card doesn't dismiss. */}
          <Pressable onPress={() => {}}>
            <Animated.View
              style={[
                styles.card,
                { backgroundColor: theme.background, opacity, transform: [{ scale }] },
              ]}>
              <ThemedText type="subtitle" style={styles.title}>
                {title}
              </ThemedText>
              {message && (
                <ThemedText type="small" themeColor="textSecondary">
                  {message}
                </ThemedText>
              )}

              <TextInput
                value={value}
                onChangeText={(text) => {
                  setValue(text);
                  setError(null);
                }}
                placeholder={placeholder}
                placeholderTextColor={theme.textSecondary}
                autoFocus
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={submit}
                accessibilityLabel={title}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundElement,
                    color: theme.text,
                    borderColor: error ? DANGER : 'transparent',
                  },
                ]}
              />

              {error && (
                <ThemedText type="small" style={{ color: DANGER }}>
                  {error}
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
                  onPress={submit}
                  style={({ pressed }) => [
                    styles.btn,
                    { backgroundColor: theme.accent },
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
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    minHeight: 48,
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
