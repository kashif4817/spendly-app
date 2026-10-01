import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatRelativeDay } from '@/lib/date';
import { formatSigned } from '@/lib/money';

type Props = {
  day: string;
  /** What the day came to: positive in, negative out. */
  net: number;
  /** The first divider sits right under a heading, so it needs less room above. */
  first?: boolean;
  /** Hide the daily net when this divider is used in a person statement. */
  showNet?: boolean;
};

/** The "Sun, 4 Jun 2026 · +Rs 500" divider that opens each day of a list. */
export function DayHeader({ day, net, first, showNet = true }: Props) {
  return (
    <View style={[styles.row, first && styles.first]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {formatRelativeDay(day)}
      </ThemedText>
      {showNet && (
        <ThemedText type="small" themeColor="textSecondary">
          {formatSigned(net)}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.one,
  },
  first: {
    paddingTop: Spacing.two,
  },
});



