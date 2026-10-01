import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

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
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  addSharedEntry,
  deleteSharedEntry,
  getBookMembers,
  getCurrentUserId,
  getSharedEntry,
  getSharedMemberName,
  restoreSharedEntry,
  updateSharedEntry,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { todayKey } from '@/lib/date';
import { confirm } from '@/lib/confirm';
import { parseAmount } from '@/lib/money';
import { offerUndo } from '@/lib/undo';

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
      const before = existing;
      updateSharedEntry(existing.id, { payerId, amount: value, note: note.trim(), day });
      if (before) {
        offerUndo('Shared-book entry updated', () =>
          updateSharedEntry(before.id, {
            payerId: before.payer_id,
            amount: before.amount,
            note: before.note,
            day: before.day,
          })
        );
      }
    } else {
      addSharedEntry({ bookId, payerId, amount: value, note: note.trim(), day });
    }
    router.back();
  };

  const remove = () =>
    confirm({
      title: 'Delete this entry?',
      message: 'It will disappear for both of you. You can undo for a few seconds.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        if (existing) {
          deleteSharedEntry(existing.id);
          offerUndo('Shared-book entry deleted', () => restoreSharedEntry(existing));
        }
        router.back();
      },
    });

  const youPaid = payerId === me;
  const title = isEdit ? 'Edit shared entry' : 'Add shared entry';

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
          <View style={styles.payer}>
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
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              {youPaid
                ? `Recorded as ${otherName} owing you.`
                : `Recorded as you owing ${otherName}.`}
            </ThemedText>
          </View>

          <AmountField
            value={amount}
            onChangeText={setAmount}
            color={youPaid ? MoneyColors.in : MoneyColors.out}
            autoFocus={!isEdit}
            editable={canEdit}
          />

          <FormCard>
            <FormRow icon="notes" label="Note">
              <FormInput
                value={note}
                onChangeText={setNote}
                placeholder="What was it for?"
                editable={canEdit}
              />
            </FormRow>
            <FormRow icon="event" label="Date">
              <DateStepper day={day} onChange={setDay} color={theme.accent} />
            </FormRow>
          </FormCard>

          {!canEdit && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              {otherName} added this entry, so only they can change it.
            </ThemedText>
          )}

          <PrimaryButton
            label={isEdit ? 'Save changes' : title}
            onPress={save}
            color={theme.accent}
            disabled={!canSave}
          />

          {isEdit && canEdit && (
            <FormLinks>
              <FormLink label="Delete" icon="delete-outline" color={MoneyColors.out} onPress={remove} />
            </FormLinks>
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
    gap: Spacing.three,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  payer: {
    gap: Spacing.two,
  },
  centered: {
    textAlign: 'center',
  },
});
