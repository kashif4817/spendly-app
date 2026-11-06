/**
 * Choose people — and add one without leaving what you were doing.
 *
 * WHY: splitting a bill is exactly the moment you discover somebody isn't on
 * your list yet. Sending the user back to the Loans tab to create them, then
 * back here to start the split again, loses the amount, the date and the
 * names already picked — for a name that takes two seconds to type. So the
 * search box IS the add box: type a name nobody has, and the first row
 * offers to make them.
 *
 * It is a sheet rather than more chips because a chip row is only fast while
 * it fits on one screen. Chips stay on the form for the handful of people you
 * split with constantly; this is for everybody else, and for the one who
 * isn't there yet.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAvoider } from '@/components/keyboard-avoider';
import { ThemedText } from '@/components/themed-text';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { matchesQuery, normaliseName } from '@/lib/people-match';

export function PersonPickerSheet({
  visible,
  title,
  people,
  selected,
  multi,
  onToggle,
  onCreate,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** Everyone on the list, in the order the form wants them shown. */
  people: string[];
  /** Who is already chosen — ticked, and kept at the top in multi mode. */
  selected: string[];
  /** True for "split between", where several names are the answer. */
  multi?: boolean;
  onToggle: (person: string) => void;
  /**
   * Make somebody new. Return a string to report why it couldn't be done —
   * a clash, usually — and the sheet shows it under the field rather than
   * throwing the typed name away.
   */
  onCreate: (name: string) => string | void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // A sheet that opened holding the last search would be answering a question
  // nobody asked this time.
  useEffect(() => {
    if (visible) {
      setQuery('');
      setError(null);
    }
  }, [visible]);

  // Word-start matching, so searching "sir" does not offer up every Mudasir.
  const needle = normaliseName(query);
  const matches = useMemo(
    () => (needle ? people.filter((p) => matchesQuery(p, needle)) : people),
    [people, needle]
  );

  /** Nothing goes by this name yet, so offering to create it is not a duplicate. */
  const canCreate = needle.length > 0 && !people.some((p) => normaliseName(p) === needle);

  const create = () => {
    const reason = onCreate(query.trim());
    if (reason) {
      setError(reason);
      return;
    }
    setQuery('');
    setError(null);
    // Single-pick closes on its own; multi stays open for the next name.
    if (!multi) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      {/* The search box IS the add box, so this sheet always has a keyboard
          over it. The avoider wraps the backdrop rather than sitting inside
          it, so the sheet still measures against a full-width parent. */}
      <KeyboardAvoider style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
          {/* Swallows taps so pressing the sheet itself doesn't close it. */}
          <Pressable onPress={() => {}} style={styles.sheetWrap}>
            <View
              style={[
                styles.sheet,
                theme.glassOverlay,
                { paddingBottom: insets.bottom + Spacing.three },
              ]}>
              <View style={[styles.grabber, { backgroundColor: theme.backgroundSelected }]} />
              <ThemedText type="smallBold" style={styles.title}>
                {title}
              </ThemedText>

              <View style={[styles.searchBar, theme.glass]}>
                <MaterialIcons name="search" size={18} color={theme.textSecondary} />
                <TextInput
                  value={query}
                  onChangeText={(next) => {
                    setQuery(next);
                    setError(null);
                  }}
                  placeholder="Search, or type a new name"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType={canCreate ? 'done' : 'search'}
                  onSubmitEditing={() => canCreate && create()}
                  style={[styles.searchInput, { color: theme.text }]}
                  accessibilityLabel="Search people, or type a new name"
                />
                {query.length > 0 && (
                  <Pressable
                    onPress={() => setQuery('')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear">
                    <MaterialIcons name="close" size={18} color={theme.textSecondary} />
                  </Pressable>
                )}
              </View>

              {error && (
                <ThemedText type="small" style={[styles.error, { color: '#e5484d' }]}>
                  {error}
                </ThemedText>
              )}

              <FlatList
                data={matches}
                keyExtractor={(person) => person}
                // The cap lives on the part that scrolls, so the sheet still
                // sizes itself from its content — the same shape every other
                // sheet in this app settled on.
                style={[styles.list, { maxHeight: Math.round(height * 0.4) }]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                  canCreate ? (
                    <Pressable
                      onPress={create}
                      style={({ pressed }) => [
                        styles.row,
                        theme.glass,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${query.trim()} to your list`}>
                      <MaterialIcons name="person-add" size={18} color={theme.accentTint} />
                      <ThemedText type="smallBold" numberOfLines={1} style={styles.rowName}>
                        Add “{query.trim()}”
                      </ThemedText>
                    </Pressable>
                  ) : null
                }
                renderItem={({ item }) => {
                  const on = selected.includes(item);
                  return (
                    <Pressable
                      onPress={() => {
                        onToggle(item);
                        if (!multi) onClose();
                      }}
                      style={({ pressed }) => [
                        styles.row,
                        theme.glass,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}>
                      <MaterialIcons
                        name={on ? 'check-circle' : 'radio-button-unchecked'}
                        size={18}
                        color={on ? theme.accent : theme.textSecondary}
                      />
                      <ThemedText type="smallBold" numberOfLines={1} style={styles.rowName}>
                        {item}
                      </ThemedText>
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  canCreate ? null : (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                      Nobody on your list yet. Type a name above to add the first one.
                    </ThemedText>
                  )
                }
              />

              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.done, pressed && styles.pressed]}
                accessibilityRole="button">
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {multi ? 'Done' : 'Cancel'}
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: Scrim,
    justifyContent: 'flex-end',
  },
  sheetWrap: {
    width: '100%',
  },
  sheet: {
    width: '100%',
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: Radius.large,
    borderTopRightRadius: Radius.large,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.two,
  },
  title: {
    paddingBottom: Spacing.two,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
    includeFontPadding: false,
  },
  error: {
    paddingTop: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  list: {
    marginTop: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginBottom: Spacing.one,
  },
  rowName: {
    flex: 1,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  done: {
    alignItems: 'center',
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  pressed: {
    opacity: 0.8,
  },
});
