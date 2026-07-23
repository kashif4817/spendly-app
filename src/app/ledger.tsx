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
  addLedgerEntry,
  deleteLedgerEntry,
  getLedgerEntry,
  getPeople,
  updateLedgerEntry,
  type LedgerDirection,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatRelativeDay, todayKey } from '@/lib/date';
import { parseAmount } from '@/lib/money';

export default function LedgerEntryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; person?: string; direction?: string }>();
  const editId = params.id ?? null;

  const existing = useMemo(() => (editId ? getLedgerEntry(editId) : null), [editId]);

  const [person, setPerson] = useState(existing?.person ?? params.person ?? '');
  const [direction, setDirection] = useState<LedgerDirection>(
    existing?.direction ?? (params.direction === 'took' ? 'took' : 'gave')
  );
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [day, setDay] = useState(existing?.day ?? todayKey());

  const accent = direction === 'gave' ? MoneyColors.in : MoneyColors.out;

  // Suggest previously-added people (filtered by what's typed).
  const allPeople = useQuery(() => getPeople());
  const suggestions = useMemo(() => {
    const q = person.trim().toLowerCase();
    const names = allPeople.map((p) => p.person);
    const list = q ? names.filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q) : names;
    return list.slice(0, 8);
  }, [allPeople, person]);

  function onSave() {
    const value = parseAmount(amount);
    if (!person.trim()) {
      Alert.alert('Enter a name', 'Who is this with?');
      return;
    }
    if (value <= 0) {
      Alert.alert('Enter an amount', 'The amount must be greater than zero.');
      return;
    }
    const payload = { person: person.trim(), direction, amount: value, note: note.trim(), day };
    if (editId) updateLedgerEntry(editId, payload);
    else addLedgerEntry(payload);
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
          deleteLedgerEntry(editId);
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
          {/* Direction */}
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { label: 'You gave', value: 'gave', color: MoneyColors.in },
              { label: 'You took', value: 'took', color: MoneyColors.out },
            ]}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            {direction === 'gave'
              ? 'You gave them money — increases what they owe you (receivable).'
              : 'You took money from them — increases what you owe (payable).'}
          </ThemedText>

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
              autoFocus={!editId && !!person}
            />
          </View>

          {/* Person */}
          <ThemedText type="smallBold" style={styles.label}>
            Person
          </ThemedText>
          <TextInput
            value={person}
            onChangeText={setPerson}
            placeholder="e.g. Ali"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
            style={[styles.textInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          />
          {suggestions.length > 0 && (
            <View style={styles.suggestions}>
              {suggestions.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPerson(p)}
                  style={[styles.suggestChip, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="small">{p}</ThemedText>
                </Pressable>
              ))}
            </View>
          )}

          {/* Note */}
          <ThemedText type="smallBold" style={styles.label}>
            Note (optional)
          </ThemedText>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. For groceries"
            placeholderTextColor={theme.textSecondary}
            style={[styles.textInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
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
            <ThemedText style={styles.saveText}>{editId ? 'Save changes' : 'Add entry'}</ThemedText>
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
  hint: {
    marginTop: -Spacing.two,
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
  textInput: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  suggestChip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
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
