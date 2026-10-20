import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getUndoAction, runUndo, subscribeUndo, type UndoAction } from '@/lib/undo';

export function UndoToast() {
  const theme = useTheme();
  const [action, setAction] = useState<UndoAction | null>(getUndoAction);

  useEffect(() => subscribeUndo(() => setAction(getUndoAction())), []);

  if (!action) return null;

  return (
    <View
      pointerEvents="box-none"
      // Just above the tab bar. BottomTabInset already includes the bar's
      // safe-area inset, so adding insets.bottom on top double-counted it.
      style={[styles.position, { bottom: BottomTabInset + Spacing.three }]}
      accessibilityLiveRegion="polite">
      <View style={[styles.toast, theme.glass]}>
        <MaterialIcons name="check-circle" size={20} color={theme.accent} />
        <ThemedText type="smallBold" style={styles.message} numberOfLines={1}>
          {action.label}
        </ThemedText>
        <Pressable
          onPress={() => void runUndo()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Undo ${action.label}`}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Undo
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  position: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  toast: {
    width: '92%',
    maxWidth: MaxContentWidth,
    minHeight: 52,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  message: {
    flex: 1,
  },
});
