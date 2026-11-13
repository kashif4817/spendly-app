import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

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
import { EntryHistory, RequestCard } from '@/components/entry-safety';
import { Segmented } from '@/components/segmented';
import { KeyboardAvoider } from '@/components/keyboard-avoider';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  addSharedEntry,
  deleteSharedEntry,
  getBookMembers,
  getCurrentUserId,
  getEntryHistory,
  getOpenRequestForEntry,
  getSharedEntry,
  getSharedMemberName,
  restoreSharedEntry,
  SHARED_NOTE_MAX,
  updateSharedEntry,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { todayKey } from '@/lib/date';
import { confirm, notify } from '@/lib/confirm';
import { freeTimeLeft, isEntryLocked } from '@/lib/entry-lock';
import { parseAmount } from '@/lib/money';
import { offerUndo } from '@/lib/undo';
import {
  EntryRequestError,
  requestEntryChange,
  type RequestedChange,
} from '@/sync/entry-requests';

/**
 * Add, edit or look at one entry in a shared book.
 *
 * The only thing that makes this different from a personal entry is the "who
 * paid" choice: it writes `payer_id`, which is what lets the same row read as
 * "I paid" on one phone and "he paid" on the other.
 *
 * Past its first 24 hours an entry is locked (lib/entry-lock.ts): its author
 * can still propose a change or a delete, but it goes to the other member as
 * a request, and the entry stays exactly as it is until they approve. Either
 * member can open any entry to read its history.
 */
export default function SharedEntryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string;
    book?: string;
    payer?: string;
    /**
     * Filled in when the chat spotted money in a message and offered to
     * record it (see lib/money-in-text.ts). They are a starting point, not a
     * decision — the form still has to be saved, which is what makes a guess
     * from a sentence safe to make.
     */
    amount?: string;
    note?: string;
  }>();

  const me = getCurrentUserId() ?? '';
  const existing = useQuery(() => (params.id ? getSharedEntry(params.id) : null), [params.id]);
  const entryId = existing?.id ?? '';
  const history = useQuery(() => (entryId ? getEntryHistory(entryId) : []), [entryId]);
  const openRequest = useQuery(
    () => (entryId ? getOpenRequestForEntry(entryId) : null),
    [entryId]
  );

  const bookId = existing?.book_id ?? params.book ?? '';
  const members = useQuery(() => getBookMembers(bookId), [bookId]);
  const otherId = members.find((m) => m.user_id !== me)?.user_id ?? null;
  const otherName = otherId ? (getSharedMemberName(otherId) ?? 'Them') : 'Them';
  const otherFirst = otherName.split(' ')[0];

  const [payerId, setPayerId] = useState(params.payer ?? me);
  const [amount, setAmount] = useState(params.amount ?? '');
  const [note, setNote] = useState(params.note ?? '');
  const [day, setDay] = useState(todayKey());
  const [sending, setSending] = useState(false);

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
  const isAuthor = !isEdit || existing.author_id === me;
  const locked = isEdit && isEntryLocked(existing);
  const waiting = !!openRequest;
  // What the fields may do: nothing at all while a request is out, since the
  // entry is frozen until it's answered.
  const editable = isAuthor && !waiting;
  const changed =
    isEdit &&
    (payerId !== existing.payer_id ||
      value !== existing.amount ||
      note.trim() !== existing.note ||
      day !== existing.day);
  const canSave = value > 0 && editable && !!bookId && (!isEdit || changed) && !sending;

  const save = () => {
    if (!canSave) return;
    if (isEdit && locked) {
      sendRequest({ kind: 'edit', payerId, amount: value, note: note.trim(), day });
      return;
    }
    if (isEdit) {
      const before = existing;
      updateSharedEntry(existing.id, { payerId, amount: value, note: note.trim(), day });
      offerUndo('Shared-book entry updated', () =>
        updateSharedEntry(before.id, {
          payerId: before.payer_id,
          amount: before.amount,
          note: before.note,
          day: before.day,
        })
      );
    } else {
      addSharedEntry({ bookId, payerId, amount: value, note: note.trim(), day });
    }
    router.back();
  };

  /** Past the 24 hours: ask the other member instead of changing it. */
  const sendRequest = (change: RequestedChange) => {
    if (!existing) return;
    const deleting = change.kind === 'delete';
    confirm({
      title: deleting ? 'Ask to delete this entry?' : 'Ask to change this entry?',
      message: `It was added more than 24 hours ago, so ${otherName} has to approve ${
        deleting ? 'deleting it' : 'the change'
      }. Nothing changes until they do.`,
      confirmLabel: 'Send request',
      onConfirm: async () => {
        setSending(true);
        try {
          await requestEntryChange(existing.id, change);
          notify('Request sent', `${otherName} will be asked to approve it.`);
          router.back();
        } catch (e) {
          notify(
            'Couldn’t send the request',
            e instanceof EntryRequestError ? e.message : 'Check your connection and try again.'
          );
        } finally {
          setSending(false);
        }
      },
    });
  };

  const remove = () => {
    if (!existing) return;
    if (locked) {
      sendRequest({ kind: 'delete' });
      return;
    }
    confirm({
      title: 'Delete this entry?',
      message:
        'It will disappear for both of you and show in the book’s activity. You can undo for a few seconds.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        deleteSharedEntry(existing.id);
        offerUndo('Shared-book entry deleted', () => restoreSharedEntry(existing));
        router.back();
      },
    });
  };

  /**
   * Take this entry to the book's chat, already attached.
   *
   * The other direction of the same link the chat's attach button makes: a
   * question about an entry usually starts while looking at it, and a chat
   * screen you have to go and find the entry in again is a chat screen the
   * question gets asked outside the app instead.
   */
  const discuss = () => {
    if (!existing) return;
    router.push(
      `/shared-chat?book=${encodeURIComponent(bookId)}&entry=${encodeURIComponent(existing.id)}` as Href
    );
  };

  const youPaid = payerId === me;
  const title = !isEdit
    ? 'Add shared entry'
    : !isAuthor || waiting
      ? 'Shared entry'
      : locked
        ? 'Change shared entry'
        : 'Edit shared entry';
  const timeLeft = isEdit && isAuthor && !locked ? freeTimeLeft(existing) : null;

  // Opened as an existing entry that is no longer here — deleted on the other
  // phone, or by an approved request while this screen was open. Without
  // this it would quietly turn into an empty "Add" form.
  if (params.id && !existing) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Shared entry' }} />
        <View style={styles.gone}>
          <ThemedText type="smallBold">This entry was deleted</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
            Its details are kept in the book’s Activity.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoider style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          // A decimal pad has no Done key on Android, so a drag is the
          // only gesture left that can put the keyboard away.
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}>
          {openRequest && (
            <RequestCard
              request={openRequest}
              me={me}
              onDone={() => router.back()}
            />
          )}

          <View style={styles.payer} pointerEvents={editable ? 'auto' : 'none'}>
            <ThemedText type="smallBold">Who paid?</ThemedText>
            <View style={!editable && styles.readOnly}>
              <Segmented
                options={[
                  { label: 'I paid', value: 'me', color: MoneyColors.in },
                  { label: `${otherFirst} paid`, value: 'them', color: MoneyColors.out },
                ]}
                value={youPaid ? 'me' : 'them'}
                onChange={(next) => {
                  if (next === 'me') setPayerId(me);
                  else if (otherId) setPayerId(otherId);
                }}
              />
            </View>
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
            editable={editable}
          />

          <FormCard>
            <FormRow icon="notes" label="Note">
              <FormInput
                value={note}
                onChangeText={setNote}
                placeholder="What was it for?"
                maxLength={SHARED_NOTE_MAX}
                editable={editable}
              />
            </FormRow>
            <FormRow icon="event" label="Date">
              <View pointerEvents={editable ? 'auto' : 'none'} style={!editable && styles.readOnly}>
                <DateStepper day={day} onChange={setDay} color={theme.accent} />
              </View>
            </FormRow>
          </FormCard>

          {!isAuthor && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered} numberOfLines={1}>
              Added by {otherName} · only they can change it
            </ThemedText>
          )}
          {isAuthor && locked && !waiting && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered} numberOfLines={1}>
              Locked after 24h · changes need {otherName}’s approval
            </ThemedText>
          )}
          {timeLeft && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered} numberOfLines={1}>
              Free to edit for {timeLeft} more
            </ThemedText>
          )}

          {editable && (
            <PrimaryButton
              label={!isEdit ? title : locked ? 'Request change' : 'Save changes'}
              onPress={save}
              color={theme.accent}
              busy={sending}
              disabled={!canSave}
            />
          )}

          {isEdit && (
            <FormLinks>
              <FormLink label="Discuss" icon="chat-bubble-outline" color={theme.accent} onPress={discuss} />
              {editable && (
                <FormLink
                  label={locked ? 'Request delete' : 'Delete'}
                  icon="delete-outline"
                  color={MoneyColors.out}
                  onPress={remove}
                />
              )}
            </FormLinks>
          )}

          {isEdit && history.length > 0 && (
            <EntryHistory entry={existing} logs={history} me={me} />
          )}
        </ScrollView>
      </KeyboardAvoider>
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
  readOnly: {
    opacity: 0.6,
  },
  gone: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    padding: Spacing.four,
  },
});
