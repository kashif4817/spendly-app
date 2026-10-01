import { Image, type ImageStyle } from 'expo-image';
import type { StyleProp } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

const MARK = require('../../assets/images/spendly-mark.png');
/** Same mark with the navy bars in white, for dark backgrounds. */
const MARK_LIGHT = require('../../assets/images/spendly-mark-light.png');

/**
 * The Spendly logo, in the version that reads on the current theme: the
 * navy bars all but vanish on the dark background, so dark mode swaps them
 * for white and keeps the teal arrow.
 */
export function BrandMark({ style }: { style?: StyleProp<ImageStyle> }) {
  const scheme = useColorScheme();
  return (
    <Image
      source={scheme === 'dark' ? MARK_LIGHT : MARK}
      style={style}
      contentFit="contain"
      accessibilityLabel="Spendly"
    />
  );
}
