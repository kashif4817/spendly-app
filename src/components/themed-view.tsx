import { View, type ViewProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
};

/**
 * A themed box.
 *
 * `type="backgroundElement"` means "a surface", and under the Aurora look a
 * surface is a pane of glass — fill, lit edge and inner highlight together,
 * not just a background colour. Handing back the fill alone would leave every
 * card in the app a flat translucent rectangle with no edge to catch light.
 *
 * `type="background"` stays transparent on purpose: the app-wide mesh is the
 * background, and painting over it would hide the thing all the glass frosts.
 */
export function ThemedView({ style, lightColor, darkColor, type, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();

  if (type === 'backgroundElement') {
    return <View style={[theme.glass, style]} {...otherProps} />;
  }

  if (type === undefined || type === 'background') {
    return <View style={style} {...otherProps} />;
  }

  return <View style={[{ backgroundColor: theme[type] }, style]} {...otherProps} />;
}
