import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AmountField,
  DateStepper,
  FormCard,
  FormInput,
  FormLink,
  FormLinks,
  FormRow,
  PrimaryButton,
} from '@/components/form';
import { Segmented } from '@/components/segmented';
import { confirm, notify } from '@/lib/confirm';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import {
  addLedgerEntry,
  deleteLedgerEntry,
  getLedgerEntry,
  getPeople,
  restoreLedgerEntry,
  updateLedgerEntry,
  type LedgerDirection,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { todayKey } from '@/lib/date';
import { parseAmount } from '@/lib/money';
import { offerUndo } from '@/lib/undo';

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
      notify('Enter a name', 'Who is this with?');
      return;
    }
    if (value <= 0) {
      notify('Enter an amount', 'The amount must be greater than zero.');
      return;
    }
    const payload = { person: person.trim(), direction, amount: value, note: note.trim(), day };
    if (editId) {
      const before = existing;
      updateLedgerEntry(editId, payload);
      if (before) {
        offerUndo('Ledger entry updated', () =>
          updateLedgerEntry(editId, {
            person: before.person,
            direction: before.direction,
            amount: before.amount,
            note: before.note,
            day: before.day,
          })
        );
      }
    } else {
      addLedgerEntry(payload);
    }
    router.back();
  }

  function onDelete() {
    if (!editId) return;
    confirm({
      title: 'Delete entry',
      message: 'This removes the entry. You can undo for a few seconds.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
  const removed = existing ?? getLedgerEntry(editId);
  if (!removed) return;
  deleteLedgerEntry(editId);
  offerUndo('Ledger entry deleted', () => restoreLedgerEntry(removed));
  router.back();
      },
    });
  }

  const title = editId ? 'Edit loan' : 'Add loan';

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.direction}>
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
                ? 'You gave them money, so they owe you more.'
                : 'You took money from them, so you owe them more.'}
            </ThemedText>
          </View>

          <AmountField
            value={amount}
            onChangeText={setAmount}
            color={accent}
            autoFocus={!editId && !!person}
          />

          <FormCard>
            <FormRow icon="person-outline" label="Person">
              <FormInput
                value={person}
                onChangeText={setPerson}
                placeholder="e.g. Ali"
                autoCapitalize="words"
              />
              {suggestions.length > 0 && (
                <View style={styles.suggestions}>
                  {suggestions.map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => setPerson(p)}
                      style={({ pressed }) => [
                        styles.suggestChip,
                        theme.glassWeak,
                        pressed && styles.pressed,
                      ]}>
                      <ThemedText type="small">{p}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              )}
            </FormRow>

            <FormRow icon="notes" label="Note (optional)">
              <FormInput value={note} onChangeText={setNote} placeholder="e.g. For groceries" />
            </FormRow>

            <FormRow icon="event" label="Date">
              <DateStepper day={day} onChange={setDay} color={accent} />
            </FormRow>
          </FormCard>

          <PrimaryButton label={editId ? 'Save changes' : title} onPress={onSave} color={accent} />

          {editId && (
            <FormLinks>
              <FormLink label="Delete" icon="delete-outline" color={MoneyColors.out} onPress={onDelete} />
            </FormLinks>
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
  direction: {
    gap: Spacing.two,
  },
  hint: {
    textAlign: 'center',
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  suggestChip: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  pressed: {
    opacity: 0.7,
  },
});
