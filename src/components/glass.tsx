/**
 * The Aurora glass kit.
 *
 * Every surface in the app is one of these. They exist so the recipe for a
 * pane — translucent fill, bright hairline edge, inset highlight along the top
 * — lives in one place instead of being retyped into forty stylesheets, and so
 * that changing the look later means changing this file.
 *
 * See `constants/theme.ts` for why there is no real backdrop blur, and why
 * over a mesh gradient that costs almost nothing visually.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

/** How deep a pane sits: an inset on glass, an ordinary card, or the hero. */
export type Depth = 'weak' | 'base' | 'strong';

function useDepth(depth: Depth): ViewStyle {
  const theme = useTheme();
  return depth === 'weak' ? theme.glassWeak : depth === 'strong' ? theme.glassStrong : theme.glass;
}

/**
 * The mesh of coloured light the whole app sits on.
 *
 * Mounted once at the root, behind everything. Without it every pane below
 * would be frosting a flat colour, which is the one thing glass cannot do.
 * `experimental_backgroundImage` is native in RN 0.81 — no gradient library.
 */
export function AuroraBackground({ children }: { children?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      <View
        pointerEvents="none"
        style={[styles.fill, styles.absolute, { experimental_backgroundImage: theme.mesh }]}
      />
      {children}
    </View>
  );
}

export type GlassViewProps = ViewProps & {
  depth?: Depth;
  /** Corner radius; defaults to the card radius. */
  radius?: number;
};

/** A plain pane of glass. The building block for everything below. */
export function GlassView({ depth = 'base', radius = Radius.card, style, ...rest }: GlassViewProps) {
  const surface = useDepth(depth);
  return <View style={[surface, { borderRadius: radius }, style]} {...rest} />;
}

export type GlassCardProps = GlassViewProps & {
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
};

/**
 * A card, tappable or not.
 *
 * A pressed pane brightens rather than fading: glass lit from behind looks
 * wrong when it dims, and opacity on a translucent surface turns it muddy.
 */
export function GlassCard({
  depth = 'base',
  radius = Radius.card,
  onPress,
  onLongPress,
  style,
  children,
  ...rest
}: GlassCardProps) {
  const surface = useDepth(depth);

  if (!onPress && !onLongPress) {
    return (
      <View style={[surface, { borderRadius: radius }, style]} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [
        surface,
        { borderRadius: radius },
        style,
        pressed && styles.pressedGlass,
      ]}
      accessibilityRole="button"
      {...rest}>
      {children}
    </Pressable>
  );
}

/**
 * A pill: a filter chip, a tag, a small marker.
 *
 * Selected fills with the accent and takes white text; unselected is a weak
 * pane that lets the mesh through.
 */
export function GlassChip({
  label,
  icon,
  selected,
  onPress,
  style,
}: {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const color = selected ? '#ffffff' : theme.textSecondary;

  const body = (
    <View
      style={[
        styles.chip,
        selected
          ? {
              backgroundColor: theme.accent,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.40)',
              boxShadow: [
                { offsetX: 0, offsetY: 4, blurRadius: 14, color: 'rgba(0,0,0,0.22)' },
                {
                  offsetX: 0,
                  offsetY: 1,
                  blurRadius: 0,
                  color: 'rgba(255,255,255,0.45)',
                  inset: true,
                },
              ],
            }
          : theme.glassWeak,
        style,
      ]}>
      {icon && <MaterialIcons name={icon} size={13} color={color} />}
      <ThemedText type="smallBold" style={[styles.chipText, { color }]}>
        {label}
      </ThemedText>
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => (pressed ? styles.pressedGlass : undefined)}>
      {body}
    </Pressable>
  );
}

/**
 * A button.
 *
 *   filled  — the one action a screen wants (accent fill, white label)
 *   solid   — an action with a direction, filled: `tint` IS the fill
 *   glass   — an ordinary action
 *   tinted  — an action with a direction: `tint` colours the edge and label
 *
 * `solid` is what the two "who paid / you gave" buttons use. They were tinted
 * glass for a while, which was quieter but left the pair reading as one grey
 * block — filled, the direction is obvious before you read either label.
 */
export function GlassButton({
  label,
  icon,
  variant = 'glass',
  tint,
  disabled,
  onPress,
  style,
}: {
  label: string;
  icon?: IconName;
  variant?: 'filled' | 'solid' | 'glass' | 'tinted';
  /** Required by `tinted` (edge + label) and `solid` (the fill). */
  tint?: string;
  disabled?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const theme = useTheme();

  const ink =
    variant === 'filled' || variant === 'solid'
      ? '#ffffff'
      : variant === 'tinted'
        ? (tint ?? theme.text)
        : theme.text;

  // A filled slab still gets the lit top edge, so it belongs to the same
  // material as everything around it.
  const fill = (color: string): ViewStyle => ({
    backgroundColor: color,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
    boxShadow: [
      { offsetX: 0, offsetY: 8, blurRadius: 22, color: 'rgba(0,0,0,0.28)' },
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.45)', inset: true },
    ],
  });

  const surface: ViewStyle =
    variant === 'filled'
      ? fill(theme.accent)
      : variant === 'solid'
        ? fill(tint ?? theme.accent)
        : variant === 'tinted'
          ? { ...theme.glass, borderColor: tint ?? theme.glass.borderColor, borderWidth: 1.5 }
          : theme.glass;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        surface,
        style,
        disabled && styles.disabled,
        pressed && styles.pressedGlass,
      ]}>
      {icon && <MaterialIcons name={icon} size={18} color={ink} />}
      <ThemedText style={[styles.buttonLabel, { color: ink }]} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** A round glass button holding a single icon — header and toolbar actions. */
export function GlassIconButton({
  icon,
  label,
  size = 44,
  onPress,
  disabled,
  style,
}: {
  icon: IconName;
  /** For screen readers; icon-only buttons have no visible text. */
  label: string;
  size?: number;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        theme.glass,
        styles.iconButton,
        { width: size, height: size, borderRadius: Radius.full },
        style,
        disabled && styles.disabled,
        pressed && styles.pressedGlass,
      ]}>
      <MaterialIcons name={icon} size={Math.round(size * 0.48)} color={theme.accentTint} />
    </Pressable>
  );
}

/**
 * A hairline between rows inside one pane.
 *
 * A solid rule reads as a crack in the glass, so this is a sliver of the same
 * light the edges are made from.
 */
export function GlassDivider({ style }: { style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.divider,
        { backgroundColor: theme.scheme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(23,18,67,0.08)' },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  absolute: { ...StyleSheet.absoluteFillObject },
  // Glass brightens under a finger instead of fading — dimming a translucent
  // pane turns it muddy rather than reading as a press.
  pressedGlass: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chipText: {
    fontSize: 13,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    minHeight: 52,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
  disabled: {
    opacity: 0.4,
  },
});
