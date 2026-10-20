import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  EXPORT_PERIODS,
  EXPORT_SECTIONS,
  exportCounts,
  type ExportFormat,
  type ExportPeriod,
  type ExportSection,
} from '@/lib/export';

const ALL_SECTIONS = EXPORT_SECTIONS.map((s) => s.key);

type Props = {
  visible: boolean;
  format: ExportFormat;
  onClose: () => void;
  /** Sections come back in file order, whatever order they were ticked in. */
  onExport: (sections: ExportSection[], period: ExportPeriod) => void;
};

/**
 * Pick what goes into an export and for which period.
 *
 * Every part starts ticked and the period starts at "All time", so the common
 * case — a full backup — is still a single tap on Export. Each row shows how
 * many entries it holds for the chosen period, so an empty part is obvious
 * before the file is made.
 */
export function ExportSheet({ visible, format, onClose, onExport }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(24)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const [selected, setSelected] = useState<ExportSection[]>(ALL_SECTIONS);
  const [period, setPeriod] = useState<ExportPeriod>('all');

  // Each opening starts fresh: everything ticked, all time.
  useEffect(() => {
    if (!visible) {
      slide.setValue(24);
      opacity.setValue(0);
      return;
    }
    setSelected(ALL_SECTIONS);
    setPeriod('all');
    Animated.parallel([
      Animated.spring(slide, { toValue: 0, friction: 9, tension: 80, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
    ]).start();
  }, [visible, slide, opacity]);

  const counts = useMemo(() => (visible ? exportCounts(period) : null), [visible, period]);

  const toggle = (key: ExportSection) =>
    setSelected((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    );

  const canExport = selected.length > 0;
  const submit = () => {
    if (!canExport) return;
    onExport(
      ALL_SECTIONS.filter((key) => selected.includes(key)),
      period
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        {/* Swallows taps so pressing the sheet itself doesn't close it. */}
        <Pressable onPress={() => {}} style={styles.sheetWrap}>
          <Animated.View
            style={[
              styles.sheet,
              {
                ...theme.glassOverlay,
                paddingBottom: insets.bottom + Spacing.three,
                opacity,
                transform: [{ translateY: slide }],
              },
            ]}>
            <View style={[styles.grabber, { backgroundColor: theme.backgroundSelected }]} />

            <ThemedText type="smallBold" style={styles.title}>
              Export as {format.toUpperCase()}
            </ThemedText>

            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
              WHAT TO INCLUDE
            </ThemedText>
            {EXPORT_SECTIONS.map((section) => {
              const on = selected.includes(section.key);
              const count = counts?.[section.key] ?? 0;
              return (
                <Pressable
                  key={section.key}
                  onPress={() => toggle(section.key)}
                  style={({ pressed }) => [
                    styles.row,
                    theme.glass,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={section.label}>
                  <MaterialIcons
                    name={on ? 'check-box' : 'check-box-outline-blank'}
                    size={24}
                    color={on ? theme.accent : theme.textSecondary}
                  />
                  <View style={styles.rowText}>
                    <ThemedText type="smallBold">{section.label}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {section.hint}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {count}
                  </ThemedText>
                </Pressable>
              );
            })}

            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
              PERIOD
            </ThemedText>
            <View style={styles.chips}>
              {EXPORT_PERIODS.map((p) => {
                const active = p.key === period;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => setPeriod(p.key)}
                    style={[
                      styles.chip,
                      active ? { backgroundColor: theme.accent } : theme.glassWeak,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}>
                    <ThemedText type="small" style={{ color: active ? '#ffffff' : theme.text }}>
                      {p.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Budgets are monthly limits, so they’re included whatever the period.
            </ThemedText>

            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.btn,
                  theme.glass,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button">
                <ThemedText type="smallBold">Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={!canExport}
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: theme.accent },
                  !canExport && styles.disabled,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canExport }}>
                <ThemedText type="smallBold" style={styles.exportLabel}>
                  Export
                </ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Scrim,
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    width: '100%',
  },
  sheet: {
    borderTopLeftRadius: Radius.large,
    borderTopRightRadius: Radius.large,
    borderBottomWidth: 0,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: Spacing.two,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    paddingHorizontal: Spacing.two,
  },
  section: {
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.two,
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 56,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  btn: {
    flex: 1,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  exportLabel: {
    color: '#ffffff',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
