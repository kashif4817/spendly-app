/**
 * Hold a row, drag it up or down, drop it where it belongs.
 *
 * WHY: entries get recorded in the order you remember them, not the order they
 * happened — three things on Tuesday, typed in on Wednesday, in whatever order
 * they came to mind. Until now the only way to fix that was to edit the dates,
 * which lies about the dates. So the statement keeps a hand-set order per day
 * (`sort`, see db/index.ts) and this is how you set it.
 *
 * ONE DAY AT A TIME, deliberately. A statement is grouped by day and each
 * group shows what that day came to, so a row that could be dragged out of its
 * day would either have to change its date behind your back or leave two day
 * totals that no longer add up. Neither is worth having. The drag is clamped
 * to the group it started in, which also means the whole thing is index
 * arithmetic over a handful of equal-height rows — no measuring the list, no
 * auto-scrolling, nothing to get out of step.
 *
 * HOW IT STAYS HONEST ABOUT Z-ORDER: a group's rows are siblings inside one
 * view, so a plain `zIndex` lifts the dragged one above them. That is the
 * whole reason the statements render a FlatList of DAYS rather than a
 * SectionList of entries — in a SectionList every row is its own virtualised
 * cell, and a cell cannot be raised above the cell after it.
 *
 * The geometry follows <SwipeRow>: hold for the same beat, move in the same
 * spring, and a gesture that belongs to the list stays with the list.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { flushQueries } from '@/db/hooks';

/** How long the finger has to stay put before the row is yours to move. */
const LIFT_MS = 220;
/** How quickly the rows being displaced get out of the way. */
const SHIFT_MS = 150;
/** The lifted row grows just enough to read as "off the page". */
const LIFT_SCALE = 1.03;

type DragGroupState = {
  /** Index of the row being dragged; -1 when nothing is. */
  active: SharedValue<number>;
  /** How far the finger has travelled, in pixels, clamped to the group. */
  offset: SharedValue<number>;
  /** One row's height including the gap below it — measured, never assumed. */
  pitch: SharedValue<number>;
  count: number;
  begin: () => void;
  end: (from: number, to: number) => void;
};

const DragContext = createContext<DragGroupState | null>(null);

/**
 * One reorderable group — in practice, one day of a statement.
 *
 * `ids` is the group in the order it is currently drawn; `onReorder` gets the
 * same ids rearranged. Nothing is written here: the caller owns the data, so
 * the caller decides what a reorder means (see `reorderLedgerDay` and
 * `reorderSharedDay`).
 */
export function DragGroup({
  ids,
  onReorder,
  onDragChange,
  children,
}: {
  ids: string[];
  onReorder: (ids: string[]) => void;
  /** Called with `true` on lift and `false` on drop — for `scrollEnabled`. */
  onDragChange?: (dragging: boolean) => void;
  children: React.ReactNode;
}) {
  const active = useSharedValue(-1);
  const offset = useSharedValue(0);
  const pitch = useSharedValue(0);

  // The gesture is built once per row and lives across many renders, so it
  // reaches the current props through a ref rather than closing over them —
  // the same arrangement <SwipeRow> uses, and for the same reason.
  const latest = useRef({ ids, onReorder, onDragChange });
  useEffect(() => {
    latest.current = { ids, onReorder, onDragChange };
  }, [ids, onReorder, onDragChange]);

  const begin = useCallback(() => {
    latest.current.onDragChange?.(true);
  }, []);

  const end = useCallback(
    (from: number, to: number) => {
      const { ids: list, onReorder: reorder, onDragChange: notify } = latest.current;
      if (to !== from && from >= 0 && from < list.length && to < list.length) {
        const next = list.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        reorder(next);
        // `onReorder` writes synchronously, but screens read the database
        // through a 50 ms coalesce — three frames in which the list still
        // shows the old order. Long enough to watch the row spring back to
        // where it came from and then jump, so the read is forced now.
        flushQueries();
      }
      // Last, and in this order. The reorder above has already written the new
      // order and made the screen re-read it, so by the time the shift
      // animations are dropped the list underneath them has caught up —
      // clearing first would show the old order for a frame.
      active.value = -1;
      offset.value = 0;
      notify?.(false);
    },
    [active, offset]
  );

  const state = useMemo<DragGroupState>(
    () => ({ active, offset, pitch, count: ids.length, begin, end }),
    [active, offset, pitch, ids.length, begin, end]
  );

  return <DragContext.Provider value={state}>{children}</DragContext.Provider>;
}

/**
 * One draggable row. `index` is its position among its group's `ids`.
 *
 * Outside a <DragGroup> this is a plain passthrough, so a list that has no
 * order worth setting doesn't have to care.
 */
export function DragItem({ index, children }: { index: number; children: React.ReactNode }) {
  const state = useContext(DragContext);
  // The only hook above this line, so the early return keeps hook order sound.
  if (!state) return <>{children}</>;
  return (
    <Draggable state={state} index={index}>
      {children}
    </Draggable>
  );
}

function Draggable({
  state,
  index,
  children,
}: {
  state: DragGroupState;
  index: number;
  children: React.ReactNode;
}) {
  const { active, offset, pitch, count } = state;

  /**
   * Every row in a day is the same height, so whichever one reports first sets
   * the step the whole group moves in. Measured rather than hard-coded because
   * it grows with the phone's font-size setting — a guess would drift a row
   * further out of place with every step on exactly the phones where the rows
   * are tallest.
   */
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (height > 0) pitch.value = height;
    },
    [pitch]
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Nothing to rearrange in a group of one.
        .enabled(count > 1)
        // The hold is what separates this from scrolling the list: a finger
        // that moves early belongs to the list and never reaches us.
        .activateAfterLongPress(LIFT_MS)
        .onStart(() => {
          active.value = index;
          offset.value = 0;
          runOnJS(state.begin)();
        })
        .onUpdate((event) => {
          const step = pitch.value || 1;
          // Clamped to the group's own travel, so the row cannot be dragged
          // into the day above or below it.
          offset.value = Math.min(
            Math.max(event.translationY, -index * step),
            (count - 1 - index) * step
          );
        })
        .onEnd((_event, success) => {
          const step = pitch.value || 1;
          const to = success
            ? Math.max(0, Math.min(count - 1, index + Math.round(offset.value / step)))
            : index;
          // Sit exactly in the slot for the handover frame. The row is already
          // within half a row of it, and snapping first means the re-ordered
          // list has nothing left to jump over.
          offset.value = (to - index) * step;
          runOnJS(state.end)(index, to);
        }),
    [active, count, index, offset, pitch, state]
  );

  const style = useAnimatedStyle(() => {
    // Idle: a bare 0, not an animation, so dropping a row lands it instantly
    // instead of gliding back from wherever it was lifted.
    if (active.value < 0) {
      return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, opacity: 1 };
    }

    if (active.value === index) {
      return {
        transform: [{ translateY: offset.value }, { scale: LIFT_SCALE }],
        zIndex: 2, // above its siblings; see the note at the top of this file
        opacity: 0.94,
      };
    }

    // Everyone else: step aside if the lifted row has passed over you.
    const step = pitch.value || 1;
    const target = Math.max(
      0,
      Math.min(count - 1, active.value + Math.round(offset.value / step))
    );
    let shift = 0;
    if (active.value < index && index <= target) shift = -step;
    else if (target <= index && index < active.value) shift = step;

    return {
      transform: [{ translateY: withTiming(shift, { duration: SHIFT_MS }) }, { scale: 1 }],
      zIndex: 0,
      opacity: 1,
    };
  }, [count, index]);

  return (
    <GestureDetector gesture={pan}>
      <Reanimated.View onLayout={onLayout} style={[styles.row, style]}>
        {children}
      </Reanimated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // The wrapper must not shrink around its row, or the measured pitch — and
  // with it every step of the drag — would be wrong.
  row: {
    alignSelf: 'stretch',
  },
});
