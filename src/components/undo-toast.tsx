import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { FAB_HEIGHT, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getUndoAction, runUndo, subscribeUndo, type UndoAction } from '@/lib/undo';

export function UndoToast() {
  const theme = useTheme();
  const [action, setAction] = useState<UndoAction | null>(getUndoAction);

  useEffect(() => subscribeUndo(() => setAction(getUndoAction())), []);

  if (!action) return null;

  return (
    // Positioned by <BottomBanners>, which stacks this with the update banner
    // just above the tab bar and lifts the Add button clear of both.
    <View pointerEvents="box-none" accessibilityLiveRegion="polite">
      {/* Overlay weight, not card weight: this floats over the content rather
          than sitting in it, and at card weight the list showed through and
          tangled with the label. The glass set goes FIRST so the shadow and
          corner below win over the ones it carries. */}
      <View style={[theme.glassOverlay, styles.toast]}>
        <MaterialIcons name="check-circle" size={20} color={theme.accent} />
        <ThemedText type="smallBold" style={styles.message} numberOfLines={1}>
          {action.label}
        </ThemedText>
        {/* A pill rather than bare text. At 34pt tall it is a real target and
            it reads as the action it is. */}
        <Pressable
          onPress={() => void runUndo()}
          hitSlop={8}
          style={({ pressed }) => [styles.undo, theme.glassWeak, pressed && styles.pressed]}
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
  toast: {
    minHeight: FAB_HEIGHT,
    // Fully round, like the button it sits above, so the two read as one
    // floating layer instead of a pill and a box.
    borderRadius: Radius.full,
    // Asymmetric: the label needs clearance from the curve on the left, while
    // the Undo pill brings its own padding on the right.
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // The same shadow language as every other floating surface. The old
    // elevation + shadow* props predate the move to boxShadow and drew a
    // different shadow on Android than the rest of the app.
    boxShadow: [
      { offsetX: 0, offsetY: 10, blurRadius: 28, color: 'rgba(0,0,0,0.30)' },
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.45)', inset: true },
    ],
  },
  message: {
    flex: 1,
  },
  undo: {
    height: 34,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
});
