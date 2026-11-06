/**
 * A row you can pull sideways to do the two things you do most.
 *
 * WHY: the Loans list is the page this app is opened for, and the two actions
 * it is opened to perform — "they paid me back" and "clear this off the list"
 * — were both four taps deep behind a long press. A swipe is the gesture
 * people already have for exactly this, from every mail and chat app they
 * use, and it costs the row no width when it isn't being used.
 *
 * The geometry mirrors <ChatBubble>'s swipe-to-reply on purpose: the same
 * distances, the same spring, the same rule that a gesture even slightly more
 * vertical than horizontal belongs to the list. Two different swipes that
 * felt different would be worse than one.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';

/** How far across before the row starts to follow the finger at all. */
const ACTIVATE = 18;
/** More vertical than this and the gesture is a scroll, not a swipe. */
const FAIL_Y = 12;
/** Past this, letting go fires. */
const TRIGGER = 72;
/** Where the row stops moving, leaving a short dead zone after the trigger. */
const MAX = 96;

export type SwipeAction = {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  /** The colour of the panel revealed behind the row. */
  color: string;
  onTrigger: () => void;
};

export function SwipeRow({
  left,
  right,
  style,
  children,
}: {
  /** Revealed by pulling the row RIGHT, so it sits on the left. */
  left?: SwipeAction;
  /** Revealed by pulling the row LEFT. */
  right?: SwipeAction;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  const dragX = useSharedValue(0);

  // The screen hands down fresh closures on every render; the gesture is
  // built once and reaches the latest ones through a ref.
  const actions = useRef({ left, right });
  useEffect(() => {
    actions.current = { left, right };
  }, [left, right]);

  const canLeft = !!left;
  const canRight = !!right;
  const fireLeft = useCallback(() => actions.current.left?.onTrigger(), []);
  const fireRight = useCallback(() => actions.current.right?.onTrigger(), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canLeft || canRight)
        .activeOffsetX(
          canLeft && canRight ? [-ACTIVATE, ACTIVATE] : canLeft ? ACTIVATE : -ACTIVATE
        )
        .failOffsetY([-FAIL_Y, FAIL_Y])
        .onUpdate((event) => {
          const low = canRight ? -MAX : 0;
          const high = canLeft ? MAX : 0;
          dragX.value = Math.min(Math.max(event.translationX, low), high);
        })
        .onEnd(() => {
          if (dragX.value >= TRIGGER) runOnJS(fireLeft)();
          else if (dragX.value <= -TRIGGER) runOnJS(fireRight)();
          dragX.value = withSpring(0, { damping: 20, stiffness: 260, mass: 0.5 });
        }),
    [canLeft, canRight, dragX, fireLeft, fireRight]
  );

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: dragX.value }] }));

  /**
   * The panels are clipped to the gap the row has actually opened, rather
   * than sitting at full width underneath it.
   *
   * Every surface in this app is translucent glass over a mesh. A panel lying
   * under the row would show through it — you would see the icon ghosting
   * inside the card before the swipe had revealed anything. Widening the clip
   * with the drag means nothing is ever behind the row at all, which also
   * leaves the glass sitting on the mesh exactly as it does at rest.
   */
  const leftPanel = useAnimatedStyle(() => ({ width: Math.max(dragX.value, 0) }));
  const rightPanel = useAnimatedStyle(() => ({ width: Math.max(-dragX.value, 0) }));

  if (!canLeft && !canRight) return <View style={style}>{children}</View>;

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.wrap, style]}>
        {/* Both panels sit UNDER the row rather than beside it, so revealing
            one costs the row no width and nothing reflows as you drag. */}
        {left && (
          <Reanimated.View
            style={[styles.clip, styles.clipLeft, leftPanel]}
            pointerEvents="none">
            <View style={[styles.panel, styles.panelLeft]}>
              <MaterialIcons name={left.icon} size={20} color={left.color} />
              <ThemedText type="small" style={{ color: left.color }}>
                {left.label}
              </ThemedText>
            </View>
          </Reanimated.View>
        )}
        {right && (
          <Reanimated.View
            style={[styles.clip, styles.clipRight, rightPanel]}
            pointerEvents="none">
            <View style={[styles.panel, styles.panelRight]}>
              <MaterialIcons name={right.icon} size={20} color={right.color} />
              <ThemedText type="small" style={{ color: right.color }}>
                {right.label}
              </ThemedText>
            </View>
          </Reanimated.View>
        )}
        <Reanimated.View style={slide}>{children}</Reanimated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  // The window the row has opened. Its width is animated; what is inside is
  // a fixed panel, so the icon doesn't squash as the gap grows.
  clip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  clipLeft: {
    left: 0,
  },
  clipRight: {
    right: 0,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: MAX,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: Spacing.two,
  },
  // Pinned to the clip's own outer edge, so the icon slides in from the side
  // the gesture came from rather than crawling across.
  panelLeft: {
    left: 0,
  },
  panelRight: {
    right: 0,
  },
});
