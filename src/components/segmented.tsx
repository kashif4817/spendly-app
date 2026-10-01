import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SegmentOption<T extends string> = {
  label: string;
  value: T;
  /** Optional color for the selected pill (defaults to the accent). */
  color?: string;
};

type Props<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

/**
 * A pill-style segmented control. The track is the selection tint so it shows
 * on the page and on a card alike; the chosen pill is filled with the accent.
 */
export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  const theme = useTheme();

  return (
    <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
      {options.map((option) => {
        const selected = option.value === value;
        const background = selected ? (option.color ?? theme.accent) : 'transparent';
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, { backgroundColor: background }]}
            accessibilityRole="button"
            accessibilityState={{ selected }}>
            <ThemedText
              type="smallBold"
              style={[styles.label, { color: selected ? '#ffffff' : theme.textSecondary }]}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: Spacing.half,
    gap: Spacing.half,
  },
  segment: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
