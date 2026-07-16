import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CURRENCY, MoneyColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import {
  addCategory,
  addTransaction,
  deleteTransaction,
  getCategories,
  getTransaction,
  updateTransaction,
  type EntryType,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatRelativeDay, todayKey } from '@/lib/date';
import { parseAmount } from '@/lib/money';

export default function EntryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id ? Number(params.id) : null;

  // Load the existing entry once when editing.
  const existing = useMemo(() => (editId ? getTransaction(editId) : null), [editId]);

  const [type, setType] = useState<EntryType>(existing?.type ?? 'out');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [day, setDay] = useState(existing?.day ?? todayKey());

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  const categories = useQuery(() => getCategories(type), [type]);
  const accent = type === 'in' ? MoneyColors.in : MoneyColors.out;

  function chooseType(next: EntryType) {
    setType(next);
    // Clear the selection if the picked category doesn't belong to the new type.
    if (!getCategories(next).some((c) => c.name === category)) {
      setCategory('');
    }
  }

  function saveNewCategory() {
    const name = newCategory.trim();
    if (!name) return;
    const saved = addCategory(name, '🏷️', type);
    setCategory(saved);
    setNewCategory('');
    setAddingCategory(false);
  }

  function onSave() {
    const value = parseAmount(amount);
    if (value <= 0) {
      Alert.alert('Enter an amount', 'The amount must be greater than zero.');
      return;
    }
    if (!category) {
      Alert.alert('Pick a category', 'Choose a category for this entry.');
      return;
    }
    const payload = { type, amount: value, category, note: note.trim(), day };
    if (editId) {
      updateTransaction(editId, payload);
    } else {
      addTransaction(payload);
    }
    router.back();
  }

  function onDelete() {
    if (!editId) return;
    Alert.alert('Delete entry', 'This entry will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteTransaction(editId);
          router.back();
        },
      },
    ]);
  }

  const isToday = day === todayKey();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: editId ? 'Edit entry' : 'Add entry' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* In / Out */}
          <Segmented
            value={type}
            onChange={chooseType}
            options={[
              { label: 'Money out', value: 'out', color: MoneyColors.out },
              { label: 'Money in', value: 'in', color: MoneyColors.in },
            ]}
          />

          {/* Amount */}
          <View style={[styles.amountRow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={[styles.currency, { color: accent }]}>{CURRENCY}</ThemedText>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[styles.amountInput, { color: theme.text }]}
              autoFocus={!editId}
            />
          </View>

          {/* Category */}
          <ThemedText type="smallBold" style={styles.label}>
            Category
          </ThemedText>
          <View style={styles.chips}>
            {categories.map((cat) => {
              const selected = cat.name === category;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => setCategory(cat.name)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? accent : theme.backgroundElement,
                    },
                  ]}>
                  <ThemedText style={styles.chipEmoji}>{cat.emoji}</ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: selected ? '#ffffff' : theme.text }}>
                    {cat.name}
                  </ThemedText>
                </Pressable>
              );
            })}

            {addingCategory ? (
              <View style={[styles.newChip, { backgroundColor: theme.backgroundElement }]}>
                <TextInput
                  value={newCategory}
                  onChangeText={setNewCategory}
                  placeholder="New category"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.newInput, { color: theme.text }]}
                  autoFocus
                  onSubmitEditing={saveNewCategory}
                  returnKeyType="done"
                />
                <Pressable onPress={saveNewCategory} hitSlop={8}>
                  <ThemedText type="smallBold" style={{ color: accent }}>
                    Add
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setAddingCategory(true)}
                style={[styles.chip, styles.dashedChip, { borderColor: theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  ＋ New
                </ThemedText>
              </Pressable>
            )}
          </View>

          {/* Note */}
          <ThemedText type="smallBold" style={styles.label}>
            Note (optional)
          </ThemedText>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Lunch with team"
            placeholderTextColor={theme.textSecondary}
            style={[styles.noteInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          />

          {/* Date */}
          <ThemedText type="smallBold" style={styles.label}>
            Date
          </ThemedText>
          <View style={[styles.dateRow, { backgroundColor: theme.backgroundElement }]}>
            <Pressable onPress={() => setDay(addDays(day, -1))} hitSlop={8} style={styles.stepper}>
              <ThemedText style={styles.stepperText}>‹</ThemedText>
            </Pressable>
            <View style={styles.dateMiddle}>
              <ThemedText type="smallBold">{formatRelativeDay(day)}</ThemedText>
              {!isToday && (
                <Pressable onPress={() => setDay(todayKey())} hitSlop={6}>
                  <ThemedText type="small" style={{ color: accent }}>
                    Jump to today
                  </ThemedText>
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => !isToday && setDay(addDays(day, 1))}
              hitSlop={8}
              style={styles.stepper}>
              <ThemedText style={[styles.stepperText, isToday && { opacity: 0.3 }]}>›</ThemedText>
            </Pressable>
          </View>

          {/* Save */}
          <Pressable
            onPress={onSave}
            style={({ pressed }) => [
              styles.saveButton,
              { backgroundColor: accent },
              pressed && { opacity: 0.85 },
            ]}>
            <ThemedText style={styles.saveText}>
              {editId ? 'Save changes' : 'Add entry'}
            </ThemedText>
          </Pressable>

          {editId && (
            <Pressable onPress={onDelete} style={styles.deleteButton} hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: MoneyColors.out }}>
                Delete entry
              </ThemedText>
            </Pressable>
          )}

          <SafeAreaView edges={['bottom']} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  currency: {
    fontSize: 32,
    fontWeight: '700',
  },
  amountInput: {
    flex: 1,
    fontSize: 40,
    fontWeight: '700',
    paddingVertical: Spacing.two,
  },
  label: {
    marginTop: Spacing.one,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  chipEmoji: {
    fontSize: 15,
  },
  dashedChip: {
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  newChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  newInput: {
    minWidth: 110,
    fontSize: 14,
    paddingVertical: Spacing.one,
  },
  noteInput: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  stepper: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: {
    fontSize: 28,
    fontWeight: '600',
  },
  dateMiddle: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
    paddingVertical: Spacing.three,
  },
  saveButton: {
    marginTop: Spacing.three,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  saveText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  deleteButton: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
});
