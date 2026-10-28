import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UndoToast } from '@/components/undo-toast';
import { UpdatePrompt } from '@/components/update-prompt';
import { MaxContentWidth, Spacing, TAB_BAR_HEIGHT } from '@/constants/theme';
import { setBannerHeight } from '@/lib/bottom-banner';

/**
 * The floating banners, as one stack just above the tab bar.
 *
 * They used to position themselves individually, which meant two bugs: both
 * sat at exactly the floating Add button's height and were drawn under it, and
 * when both showed at once they landed on top of each other. As one column
 * they stack in order and there is a single height for the Add button to lift
 * by — see `lib/bottom-banner`.
 *
 * The offset is measured (TAB_BAR_HEIGHT + the real inset) rather than taken
 * from the BottomTabInset constant, which only estimates the bottom inset and
 * is wrong by ~20px on three-button navigation.
 */
export function BottomBanners() {
  const insets = useSafeAreaInsets();

  // Reports 0 when both children render null, which is what parks the Add
  // button back at its resting position.
  const onLayout = (event: LayoutChangeEvent) =>
    setBannerHeight(event.nativeEvent.layout.height);

  return (
    <View
      // box-none, so the gap between banners does not swallow taps meant for
      // the screen underneath.
      pointerEvents="box-none"
      onLayout={onLayout}
      style={[styles.anchor, { bottom: TAB_BAR_HEIGHT + insets.bottom + Spacing.three }]}>
      <View pointerEvents="box-none" style={styles.column}>
        {/* Update first: it is the longer-lived of the two, so a passing undo
            appears nearest the thumb rather than shoving it around. */}
        <UpdatePrompt />
        <UndoToast />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  column: {
    width: '92%',
    maxWidth: MaxContentWidth,
    gap: Spacing.two,
  },
});
