import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CURRENCY, MoneyColors } from '@/constants/app';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  addSharedEntry,
  deleteSharedEntry,
  getBookMembers,
  getCurrentUserId,
  getSharedEntry,
  getSharedMemberName,
  updateSharedEntry,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatRelativeDay, todayKey } from '@/lib/date';
import { confirm } from '@/lib/confirm';
import { parseAmount } from '@/lib/money';

/**
 * Add or edit one entry in a shared book.
 *
 * The only thing that makes this different from a personal entry is the "who
 * paid" choice: it writes `payer_id`, which is what lets the same row read as
 * "I paid" on one phone and "he paid" on the other.
 */
export default function SharedEntryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; book?: string; payer?: string }>();

  const me = getCurrentUserId() ?? '';
  const existing = useQuery(() => (params.id ? getSharedEntry(params.id) : null), [params.id]);

  const bookId = existing?.book_id ?? params.book ?? '';
  const members = useQuery(() => getBookMembers(bookId), [bookId]);
  const otherId = members.find((m) => m.user_id !== me)?.user_id ?? null;
  const otherName = otherId ? (getSharedMemberName(otherId) ?? 'Them') : 'Them';

  const [payerId, setPayerId] = useState(params.payer ?? me);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(todayKey());

  // Fill the form once the entry being edited has loaded.
  useEffect(() => {
    if (!existing) return;
    setPayerId(existing.payer_id);
    setAmount(String(existing.amount));
    setNote(existing.note);
    setDay(existing.day);
  }, [existing]);

  const value = useMemo(() => parseAmount(amount), [amount]);
  const isEdit = !!existing;
  // The server refuses an edit from anyone but the author; mirror that here so
  // the screen never offers an action that would bounce.
  const canEdit = !isEdit || existing.author_id === me;
  const canSave = value > 0 && canEdit && !!bookId;

  const save = () => {
    if (!canSave) return;
    if (isEdit) {
      updateSharedEntry(existing.id, { payerId, amount: value, note: note.trim(), day });
    } else {
      addSharedEntry({ bookId, payerId, amount: value, note: note.trim(), day });
    }
    router.back();
  };

  const remove = () =>
    confirm({
      title: 'Delete this entry?',
      message: 'It will disappear for both of you.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        if (existing) deleteSharedEntry(existing.id);
        router.back();
      },
    });

  const youPaid = payerId === me;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: isEdit ? 'Edit entry' : 'Add entry' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.field}>
            <ThemedText type="smallBold">Who paid?</ThemedText>
            <Segmented
              options={[
                { label: 'I paid', value: 'me', color: MoneyColors.in },
                { label: `${otherName.split(' ')[0]} paid`, value: 'them', color: MoneyColors.out },
              ]}
              value={youPaid ? 'me' : 'them'}
              onChange={(next) => {
                if (next === 'me') setPayerId(me);
                else if (otherId) setPayerId(otherId);
              }}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {youPaid
                ? `Recorded as ${otherName} owing you.`
                : `Recorded as you owing ${otherName}.`}
            </ThemedText>
          </View>

          <View style={styles.field}>
            <ThemedText type="smallBold">Amount</ThemedText>
            <View style={[styles.amountRow, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={[styles.currency, { color: theme.textSecondary }]}>
                {CURRENCY.trim()}
              </ThemedText>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={theme.textSecondary}
                keyboardType="numeric"
                autoFocus={!isEdit}
                style={[styles.amountInput, { color: theme.text }]}
                accessibilityLabel="Amount"
              />
            </View>
          </View>

          <View style={styles.field}>
            <ThemedText type="smallBold">Note</ThemedText>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="What was it for?"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                { backgroundColor: theme.backgroundElement, color: theme.text },
              ]}
            />
          </View>

          <View style={styles.field}>
            <ThemedText type="smallBold">Date</ThemedText>
            <View style={[styles.dateRow, { backgroundColor: theme.backgroundElement }]}>
              <Pressable
                onPress={() => setDay(addDays(day, -1))}
                hitSlop={8}
                style={styles.dateBtn}
                accessibilityRole="button"
                accessibilityLabel="Previous day">
                <ThemedText type="smallBold">‹</ThemedText>
              </Pressable>
              <ThemedText type="smallBold">{formatRelativeDay(day)}</ThemedText>
              <Pressable
                onPress={() => day < todayKey() && setDay(addDays(day, 1))}
                hitSlop={8}
                style={styles.dateBtn}
                accessibilityRole="button"
                accessibilityLabel="Next day">
                <ThemedText type="smallBold" themeColor={day < todayKey() ? 'text' : 'textSecondary'}>
                  ›
                </ThemedText>
              </Pressable>
            </View>
          </View>

          {!canEdit && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.readOnly}>
              {otherName} added this entry, so only they can change it.
            </ThemedText>
          )}

          <Pressable
            onPress={save}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.submit,
              { backgroundColor: theme.accent },
              !canSave && styles.disabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button">
            <ThemedText style={styles.submitLabel}>{isEdit ? 'Save changes' : 'Add entry'}</ThemedText>
          </Pressable>

          {isEdit && canEdit && (
            <Pressable
              onPress={remove}
              style={styles.deleteBtn}
              accessibilityRole="button">
              <ThemedText type="smallBold" style={{ color: MoneyColors.out }}>
                Delete entry
              </ThemedText>
            </Pressable>
          )}
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
    gap: Spacing.four,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  field: {
    gap: Spacing.two,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  currency: {
    fontSize: 24,
    fontWeight: '700',
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '700',
    paddingVertical: Spacing.three,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    minHeight: 50,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 50,
  },
  dateBtn: {
    paddingHorizontal: Spacing.three,
  },
  readOnly: {
    textAlign: 'center',
  },
  submit: {
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  submitLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  deleteBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
