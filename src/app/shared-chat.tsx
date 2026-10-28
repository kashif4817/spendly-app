import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Keyboard, StyleSheet, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import {
  ChatBubble,
  ChatComposer,
  ChatDay,
  ChatEntryQuote,
  EntryPickerSheet,
  type DeliveryState,
} from '@/components/chat';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  addSharedMessage,
  deleteSharedMessage,
  getBookMembers,
  getBookReadState,
  getCurrentUserId,
  getPendingRowIds,
  getSharedBook,
  getSharedEntries,
  getSharedMemberName,
  getSharedMessages,
  markBookRead,
  type SharedEntry,
  type SharedMessage,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { confirm, notify } from '@/lib/confirm';
import { dateKey } from '@/lib/date';
import { setActiveChatBook } from '@/lib/notifications';
import { useSync } from '@/sync/provider';

/**
 * The conversation attached to a shared book.
 *
 * WHY THIS EXISTS AT ALL: the statement says a balance moved; it cannot say
 * why, and "what was that 4,500 on Tuesday" was being asked somewhere else
 * entirely — in a chat app, where the answer is lost the moment you scroll
 * past it. Here the question sits next to the money it is about, and a message
 * can quote the exact entry so both people are certainly looking at the same
 * row rather than at two similar ones.
 *
 * It rides the shared sync lane with no new machinery: a message typed offline
 * goes in the outbox and uploads itself like an entry, Realtime delivers the
 * other member's as they are sent, and a push covers the case the socket
 * cannot — the app not running (see supabase/shared-chat.sql).
 */
export default function SharedChatScreen() {
  const router = useRouter();
  const { refreshShared } = useSync();
  const params = useLocalSearchParams<{ book?: string; entry?: string }>();
  const bookId = params.book ?? '';

  const me = getCurrentUserId() ?? '';
  const book = useQuery(() => getSharedBook(bookId), [bookId]);
  const members = useQuery(() => getBookMembers(bookId), [bookId]);
  const otherId = members.find((m) => m.user_id !== me)?.user_id ?? null;
  const otherName = otherId ? getSharedMemberName(otherId) : null;

  // Newest first: the list is inverted, so index 0 is the bubble at the bottom
  // of the screen. Nothing else in the app reads a thread this way, which is
  // why the reversal happens here rather than in the query.
  const thread = useQuery(() => getSharedMessages(bookId), [bookId]);
  const messages = useMemo(() => [...thread].reverse(), [thread]);

  /**
   * Entries, by id, for the quote inside a message.
   *
   * Looked up locally rather than carried in the message, so a quote shows the
   * entry's CURRENT amount and note: the author may have corrected a typo
   * since, and a quote that still showed the old figure would be the one place
   * in the app where two numbers for the same entry disagree.
   */
  const entries = useQuery(() => getSharedEntries(bookId), [bookId]);
  const entriesById = useMemo(() => {
    const map = new Map<string, SharedEntry>();
    for (const entry of entries) map.set(entry.id, entry);
    return map;
  }, [entries]);

  /** Messages still queued for upload — the clock on your own bubble. */
  const pending = useQuery(() => new Set(getPendingRowIds('shared_messages')));

  /**
   * How far the other member's device has received, and how far they have read.
   *
   * Two markers holding the `created_at` they each reached, so a message of
   * mine at or before one of them is at that stage. That is the whole of the
   * tick logic — one comparison per bubble, and no per-message bookkeeping on
   * either side.
   */
  const theirs = useQuery(
    () => (otherId ? getBookReadState(bookId, otherId) : { delivered: '', read: '' }),
    [bookId, otherId]
  );

  const [text, setText] = useState('');
  const [attachedId, setAttachedId] = useState<string | null>(params.entry ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetFor, setSheetFor] = useState<SharedMessage | null>(null);
  const list = useRef<FlatList<SharedMessage>>(null);

  const attached = attachedId ? (entriesById.get(attachedId) ?? null) : null;
  const theirLabel = otherName ?? 'They';

  /**
   * Mark the thread read, and tell the notification handler to stay quiet
   * about this book while it is on screen.
   *
   * Both run on focus rather than on mount: coming back from the entry screen
   * is a fresh read of whatever arrived meanwhile, and leaving has to let the
   * banners through again.
   */
  useFocusEffect(
    useCallback(() => {
      setActiveChatBook(bookId);
      markBookRead(bookId, me);
      return () => setActiveChatBook(null);
    }, [bookId, me])
  );

  // Anything that lands while the screen is open has been read by definition —
  // the user is looking at it. `markBookRead` only ever moves the marker
  // forward, so a message already covered costs nothing.
  useEffect(() => {
    markBookRead(bookId, me);
  }, [bookId, me, thread.length]);

  // The socket may have missed messages while the app was away, and a thread
  // is the one screen where a gap in the middle is obvious. Opening it and
  // returning to it both ask for the shared tables.
  useEffect(() => {
    void refreshShared();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshShared();
    });
    return () => sub.remove();
  }, [refreshShared]);

  const send = () => {
    const body = text.trim();
    if (!body && !attachedId) return;
    addSharedMessage({ bookId, body, entryId: attachedId });
    setText('');
    setAttachedId(null);
    // Index 0 is the newest in an inverted list, so this is the bottom.
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const openEntry = (entryId: string) =>
    router.push(`/shared-entry?id=${encodeURIComponent(entryId)}` as Href);

  const messageActions = (message: SharedMessage): SheetAction[] => {
    const actions: SheetAction[] = [];
    const quoted = message.entry_id ? entriesById.get(message.entry_id) : undefined;
    if (quoted) {
      actions.push({
        label: 'Open this entry',
        icon: 'receipt-long',
        onPress: () => openEntry(quoted.id),
      });
    }
    if (message.sender_id === me) {
      actions.push({
        label: 'Delete for everyone',
        icon: 'delete-outline',
        destructive: true,
        onPress: () =>
          confirm({
            title: 'Delete for everyone?',
            // Says what actually happens, which "it will disappear" did not:
            // the words go, the line saying something was here stays.
            message: otherName
              ? `The message is removed from your device and ${otherName}’s. You will both still see that a message was deleted.`
              : 'The message is removed from both devices. A line saying it was deleted stays in its place.',
            confirmLabel: 'Delete',
            destructive: true,
            onConfirm: () => deleteSharedMessage(message.id),
          }),
      });
    }
    return actions;
  };

  if (!book) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Chat' }} />
        <View style={styles.missing}>
          <ThemedText type="smallBold">Book not found</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            It may have been left or removed.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: otherName ?? book.name ?? 'Chat' }} />
      {/* No <KeyboardAvoidingView>. It pads by a frame it measured itself, and
          that frame is relative to this screen rather than the window — so it
          needs a header-sized correction, and then needs to know whether the
          window ALSO resized under the keyboard, which under edge-to-edge
          varies by device. Get either wrong and the bar is lifted twice.

          <ChatComposer> measures its own distance to the top of the keyboard
          instead and closes exactly that gap, which is the same answer however
          much of the work the OS already did.

          No bottom safe-area edge here either: the composer applies that inset
          itself, so the bar reaches the screen edge rather than floating. */}
      <View style={styles.flex}>
        <View style={styles.sheetWidth}>
          {/* OUTSIDE the list, not its ListEmptyComponent.
              `inverted` turns the whole content container upside down and
              flips each row back; the empty component gets no such treatment,
              so it rendered as a mirror image of itself. There is nothing to
              scroll when there are no messages anyway. */}
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <ThemedText type="smallBold" style={styles.center}>
                {otherId ? `No messages with ${theirLabel} yet` : 'Nobody has joined yet'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                {otherId
                  ? 'Ask about an entry, or attach one with the receipt button to discuss it.'
                  : 'Share the book’s join code. Anything you write here is waiting for them when they join.'}
              </ThemedText>
            </View>
          ) : (
            <FlatList
              ref={list}
              data={messages}
              keyExtractor={(message) => message.id}
              // Bottom-anchored, so a short thread sits above the composer and a
              // long one opens on the newest message without a scroll call.
              inverted
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="interactive"
              renderItem={({ item, index }) => {
                // Inverted: the message drawn ABOVE this one is the older one at
                // index + 1. Both the day divider and the grouping read from it.
                const older = messages[index + 1];
                const day = dateKey(new Date(item.created_at));
                const newDay = !older || dateKey(new Date(older.created_at)) !== day;
                const mine = item.sender_id === me;
                const gone = !!item.deleted_at;
                const quoted =
                  item.entry_id && !gone ? (entriesById.get(item.entry_id) ?? null) : null;
                // What the sheet would offer, without building it: your own
                // message can be taken back, and a quoted entry can be opened.
                // One already taken back offers neither.
                const hasActions = !gone && (mine || !!quoted);

                const delivery: DeliveryState = pending.has(item.id)
                  ? 'pending'
                  : theirs.read && item.created_at <= theirs.read
                    ? 'read'
                    : theirs.delivered && item.created_at <= theirs.delivered
                      ? 'delivered'
                      : 'sent';

                return (
                  <>
                    <ChatBubble
                      body={item.body}
                      time={item.created_at}
                      mine={mine}
                      grouped={!newDay && older?.sender_id === item.sender_id}
                      deleted={gone}
                      delivery={mine ? delivery : undefined}
                      onLongPress={hasActions ? () => setSheetFor(item) : undefined}
                      quote={
                        item.entry_id && !gone ? (
                          <ChatEntryQuote
                            entry={quoted}
                            youPaid={quoted?.payer_id === me}
                            payerName={theirLabel}
                            onTint={mine}
                            onPress={quoted ? () => openEntry(quoted.id) : undefined}
                          />
                        ) : undefined
                      }
                    />
                    {/* After the bubble in source, above it on screen. */}
                    {newDay && <ChatDay day={day} />}
                  </>
                );
              }}
            />
          )}

          <ChatComposer
            value={text}
            onChangeText={setText}
            onSend={send}
            onAttach={() => {
              // Dismissed first: a sheet that opens into a window still sized
              // around the keyboard measures the wrong height on Android.
              Keyboard.dismiss();
              return entries.length > 0
                ? setPickerOpen(true)
                : notify(
                    'No entries to discuss yet',
                    'Record who paid in the shared book first, then you can attach that entry to a message.'
                  );
            }}
            attachment={
              attachedId ? (
                <ChatEntryQuote
                  entry={attached}
                  youPaid={attached?.payer_id === me}
                  payerName={theirLabel}
                  onRemove={() => setAttachedId(null)}
                />
              ) : undefined
            }
          />
        </View>
      </View>

      <EntryPickerSheet
        visible={pickerOpen}
        entries={entries}
        me={me}
        payerName={theirLabel}
        onPick={(entry) => setAttachedId(entry.id)}
        onClose={() => setPickerOpen(false)}
      />

      <ActionSheet
        visible={sheetFor !== null}
        title="Message"
        actions={sheetFor ? messageActions(sheetFor) : []}
        onClose={() => setSheetFor(null)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  // Centred and capped like every other screen, so the thread doesn't run the
  // full width of a tablet.
  sheetWidth: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.three,
    // Inverted, so this pads the newest end — the gap above the composer.
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.four,
  },
  center: {
    textAlign: 'center',
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
  },
});
