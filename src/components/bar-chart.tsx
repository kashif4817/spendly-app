import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A single horizontal bar that fills proportionally to `value / max`. */
export function HBar({ value, max, color }: { value: number; max: number; color: string }) {
  const theme = useTheme();
  const pct = max > 0 ? Math.max(0.02, value / max) : 0;
  return (
    <View style={[styles.hTrack, { backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.hFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

export type VerticalBar = {
  label: string;
  value: number;
  /** Optional highlight (e.g. today's bar). */
  highlight?: boolean;
};

/**
 * A row of vertical bars with labels underneath — used for the weekly view.
 * Bars are scaled to the largest value in the set.
 */
export function VerticalBars({
  data,
  color,
  height = 120,
  selectedIndex,
  onSelectBar,
}: {
  data: VerticalBar[];
  color: string;
  height?: number;
  /** Index of the currently selected bar, if any. */
  selectedIndex?: number | null;
  /** Called with the bar index when a bar is tapped. */
  onSelectBar?: (index: number) => void;
}) {
  const theme = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <View style={styles.vChart}>
      {data.map((bar, i) => {
        const barHeight = Math.max(2, (bar.value / max) * height);
        const isEmpty = bar.value === 0;
        const selected = selectedIndex === i;
        const active = selected || bar.highlight;
        return (
          <Pressable key={i} style={styles.vColumn} onPress={() => onSelectBar?.(i)} hitSlop={6}>
            <View style={[styles.vBarArea, { height }]}>
              <View
                style={[
                  styles.vBar,
                  {
                    height: barHeight,
                    backgroundColor: isEmpty ? theme.backgroundSelected : color,
                    opacity: active || isEmpty ? 1 : 0.5,
                  },
                  selected && !isEmpty && { borderWidth: 2, borderColor: theme.text },
                ]}
              />
            </View>
            <ThemedText
              type={selected ? 'smallBold' : 'small'}
              themeColor={active ? 'text' : 'textSecondary'}
              style={styles.vLabel}>
              {bar.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  hTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  hFill: {
    height: '100%',
    borderRadius: 999,
  },
  vChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.one,
  },
  vColumn: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
  },
  vBarArea: {
    justifyContent: 'flex-end',
    width: '70%',
  },
  vBar: {
    width: '100%',
    borderRadius: Spacing.one,
    minHeight: 2,
  },
  vLabel: {
    fontSize: 11,
  },
});
