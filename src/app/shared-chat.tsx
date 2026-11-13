import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Keyboard, Pressable, Share, StyleSheet, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import {
  BookPickerSheet,
  ChatAmountAction,
  ChatBubble,
  ChatComposer,
  ChatDay,
  ChatEntryQuote,
  ChatHeaderTitle,
  ChatJump,
  ChatNotice,
  ChatPinnedBar,
  ChatReminderTag,
  ChatReactions,
  ChatReplyQuote,
  ChatSearchBar,
  ChatSelectionBar,
  ChatTyping,
  ChatUnreadMark,
  ChatVanishBanner,
  EntryPickerSheet,
  MessageInfoSheet,
  ReactionBar,
  STUCK_AFTER_MS,
  type DeliveryState,
} from '@/components/chat';
import { EmojiPickerSheet } from '@/components/emoji-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  addSharedEntry,
  addSharedMessage,
  clearSharedChatLocally,
  deleteSharedMessage,
  editSharedMessage,
  getBookMembers,
  getBookReadState,
  getCurrentUserId,
  getPendingRowIds,
  getSharedBalance,
  getSharedBook,
  getSharedBooks,
  getEditedEntryIds,
  getSharedEntries,
  getSharedMemberName,
  getSharedMessages,
  getSharedReactions,
  markBookRead,
  markBookUnread,
  purgeExpiredMessages,
  purgeVanishedMessages,
  readVanish,
  setSharedReaction,
  type SharedBook,
  type SharedEntry,
  type SharedMessage,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useBookMuted } from '@/hooks/use-book-muted';
import { usePeerTyping } from '@/hooks/use-peer-typing';
import { useStarredMessages } from '@/hooks/use-starred-messages';
import { useTheme } from '@/hooks/use-theme';
import { loadChatDraft, setChatDraft } from '@/lib/chat-drafts';
import { buildTranscript } from '@/lib/chat-export';
import { confirm, notify } from '@/lib/confirm';
import { dateKey } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { findAmountInText } from '@/lib/money-in-text';
import { setBookMuted } from '@/lib/muted-books';
import { setActiveChatBook } from '@/lib/notifications';
import { setMessageStarred } from '@/lib/starred-messages';
import { useSync } from '@/sync/provider';
import { setSharedBookExpiry, setSharedBookPin, setSharedBookVanish } from '@/sync/shared';
import { signalStoppedTyping, signalTyping, stopWatchingTyping, watchTyping } from '@/sync/typing';

/**
 * How long messages may be set to live, and what to call each.
 *
 * WhatsApp's ladder, give or take: anything shorter than a day turns a
 * conversation into a game of catching up, and anything longer than a month
 * is indistinguishable from "forever" to the person waiting for it.
 *
 * This is the SLOW kind of disappearing. The fast kind is the vanishing
 * session, which has no clock at all — see <ChatVanishBanner>.
 */
const EXPIRY_CHOICES: { label: string; seconds: number }[] = [
  { label: 'Off', seconds: 0 },
  { label: '24 hours', seconds: 24 * 60 * 60 },
  { label: '7 days', seconds: 7 * 24 * 60 * 60 },
  { label: '30 days', seconds: 30 * 24 * 60 * 60 },
];

const expiryLabel = (seconds: number) =>
  EXPIRY_CHOICES.find((choice) => choice.seconds === seconds)?.label ?? 'Off';

/** How far the thread has to have moved before "back to the latest" appears. */
const AWAY_FROM_BOTTOM = 320;

/** How often expired messages are swept while the thread is on screen. */
const SWEEP_MS = 30_000;

/**
 * How long after sending a message may still be corrected.
 *
 * A window, not forever: an edit is for the typo you spot as you hit send,
 * and a thread where anything can be rewritten at any time is a record of
 * nothing. It is also roughly how long the other person is likely not to have
 * read it yet, which is the difference between a correction and a rewrite of
 * something they have already answered.
 */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Below this many unread, the thread opens where it always does: at the end. */
const JUMP_TO_UNREAD_FROM = 4;

/** The tap-back a double tap leaves. */
const DOUBLE_TAP_EMOJI = '❤️';

/**
 * Where each thread was left, by book id.
 *
 * In memory rather than on disk, and deliberately: a position is only
 * meaningful against the thread as it was a moment ago. Restored across a
 * restart it would point at a conversation that has moved on, which is worse
 * than simply opening at the end.
 */
const scrollMemory = new Map<string, number>();

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
 *
 * The things it does that a general chat app cannot, because it knows what the
 * conversation is about: the balance sits under the name and settles in one
 * tap, and a message that mentions money offers to become the entry it is
 * describing (lib/money-in-text.ts).
 */
export default function SharedChatScreen() {
  const theme = useTheme();
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
  // Entries changed after they were added — their quotes carry an "Edited" tag.
  const editedEntries = useQuery(() => getEditedEntryIds(bookId), [bookId]);
  const entriesById = useMemo(() => {
    const map = new Map<string, SharedEntry>();
    for (const entry of entries) map.set(entry.id, entry);
    return map;
  }, [entries]);

  /**
   * Messages by id, for the quote inside a reply and for the pinned bar.
   *
   * Built from the thread rather than queried per bubble: a reply resolves to
   * a row this screen is already holding, and the alternative is one database
   * read per visible message on every scroll.
   */
  const messagesById = useMemo(() => {
    const map = new Map<string, SharedMessage>();
    for (const message of thread) map.set(message.id, message);
    return map;
  }, [thread]);

  /** Messages still queued for upload — the clock on your own bubble. */
  const pending = useQuery(() => new Set(getPendingRowIds('shared_messages')));

  /** What the book comes to, for the strip above the thread. */
  const balance = useQuery(() => getSharedBalance(bookId, me), [bookId, me]);

  /** Somewhere to forward a message to. Queried, not read on every render. */
  const otherBooks = useQuery(
    () => getSharedBooks().filter((candidate) => candidate.id !== bookId),
    [bookId]
  );

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

  /**
   * Every tap-back in the book, grouped by the message it is on.
   *
   * One query for the thread rather than one per bubble: reactions are a
   * handful of rows even in a long conversation, and a query per visible
   * message is what turns a scroll into a stutter.
   */
  const reactions = useQuery(() => getSharedReactions(bookId), [bookId]);
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, { emoji: string; count: number; byMe: boolean }[]>();
    for (const reaction of reactions) {
      const list = map.get(reaction.message_id) ?? [];
      const same = list.find((item) => item.emoji === reaction.emoji);
      if (same) {
        same.count += 1;
        same.byMe = same.byMe || reaction.user_id === me;
      } else {
        list.push({ emoji: reaction.emoji, count: 1, byMe: reaction.user_id === me });
      }
      map.set(reaction.message_id, list);
    }
    return map;
  }, [reactions, me]);

  const myReactionTo = (messageId: string) =>
    reactions.find((item) => item.message_id === messageId && item.user_id === me)?.emoji ?? null;

  const starred = useStarredMessages();
  const muted = useBookMuted(bookId);
  const peerTyping = usePeerTyping();

  const [text, setText] = useState('');
  const [attachedId, setAttachedId] = useState<string | null>(params.entry ?? null);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  // The draft goes out as a balance reminder — headed as one in the thread,
  // announced as one on their phone — until sent or the tag's cross is tapped.
  const [asReminder, setAsReminder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetFor, setSheetFor] = useState<SharedMessage | null>(null);
  const [reactFor, setReactFor] = useState<string | null>(null);
  /** Ids queued for forwarding — one from the sheet, or a whole selection. */
  const [forwardIds, setForwardIds] = useState<string[] | null>(null);
  const [infoFor, setInfoFor] = useState<SharedMessage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [expiryOpen, setExpiryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [away, setAway] = useState(false);
  // Bumped by the sweep, so a clock can become a warning without a message
  // having to arrive and re-render the thread for us.
  const [, setTick] = useState(0);
  const list = useRef<FlatList<SharedMessage>>(null);
  /** The live scroll offset, so leaving can remember it without a re-render. */
  const offset = useRef(0);

  const attached = attachedId ? (entriesById.get(attachedId) ?? null) : null;
  const replyTo = replyToId ? (messagesById.get(replyToId) ?? null) : null;
  const theirLabel = otherName ?? 'They';
  const expireAfter = book?.expire_after ?? 0;
  const pinnedId = book?.pinned_message ?? null;
  const pinned = pinnedId ? (messagesById.get(pinnedId) ?? null) : null;
  const vanish = readVanish(book?.vanish_state);
  const selecting = selected.size > 0;
  /** Deleting for everyone is only on offer when it is all yours to delete. */
  const allMine =
    selecting && [...selected].every((id) => messagesById.get(id)?.sender_id === me);

  /**
   * Whose words a quote is showing.
   *
   * A book has exactly two people in it, so this is 'You' or their name — and
   * a message that isn't on this device is attributed to neither, since the
   * only honest thing to say about it is that it can't be shown.
   */
  const authorOf = (message: SharedMessage | null) =>
    message && message.sender_id === me ? 'You' : theirLabel;

  /**
   * Where you had read up to when you walked in.
   *
   * FROZEN on focus, deliberately. The marker itself moves to the newest
   * message a moment later (you are, after all, looking at them), so a divider
   * that tracked it would vanish before it could do its one job: showing you
   * where to start reading.
   */
  const readUpTo = useRef('');
  const [unreadCount, setUnreadCount] = useState(0);
  /** So the jump to the first unread happens once per visit, not per render. */
  const jumped = useRef(false);

  /**
   * Mark the thread read, freeze the unread mark, keep expired messages swept,
   * listen for the other person typing, and tell the notification handler to
   * stay quiet about this book while it is on screen.
   *
   * On LEAVING, anything said in a vanishing session goes. That is the whole
   * of the promise: no clock and no "seen" handshake — you were in the room,
   * and walking out is what ends it.
   */
  useFocusEffect(
    useCallback(() => {
      const marker = getBookReadState(bookId, me).read;
      readUpTo.current = marker;
      jumped.current = false;
      setUnreadCount(
        getSharedMessages(bookId).filter(
          (message) => message.sender_id !== me && message.created_at > marker
        ).length
      );

      setActiveChatBook(bookId);
      markBookRead(bookId, me);
      watchTyping(bookId);

      // On arrival and then on a slow tick. A message that has quietly reached
      // its expiry while the screen was open should go while you are looking
      // at it, not the next time the app happens to restart.
      purgeExpiredMessages(me);
      const sweep = setInterval(() => {
        purgeExpiredMessages(me);
        setTick((n) => n + 1);
      }, SWEEP_MS);

      return () => {
        clearInterval(sweep);
        setActiveChatBook(null);
        signalStoppedTyping();
        stopWatchingTyping();
        purgeVanishedMessages(bookId, me);
        scrollMemory.set(bookId, offset.current);
        setSelected(new Set());
      };
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

  // Whatever was left unsent here last time. Guarded against the screen going
  // away mid-read, and never overwrites something already typed.
  useEffect(() => {
    let alive = true;
    void loadChatDraft(bookId).then((saved) => {
      if (alive && saved) setText((current) => current || saved);
    });
    return () => {
      alive = false;
    };
  }, [bookId]);

  /**
   * Open where you stopped reading, when there is enough to be worth it.
   *
   * Only past a handful: for one or two the newest messages are on screen
   * already, and scrolling away from them would be answering a question
   * nobody asked.
   */
  useEffect(() => {
    if (jumped.current || unreadCount < JUMP_TO_UNREAD_FROM || messages.length === 0) return;
    jumped.current = true;

    // Newest first, so the OLDEST unread is the last one that still qualifies.
    let index = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.sender_id !== me && message.created_at > readUpTo.current) {
        index = i;
        break;
      }
    }
    if (index < 0) return;

    // A beat, so the rows have laid out and the jump has something to aim at;
    // high in the frame, so the unread run reads downward from there.
    setTimeout(() => {
      list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.8 });
    }, 220);
  }, [unreadCount, messages, me]);

  /**
   * Otherwise, open where you left off.
   *
   * Only when there is nothing new: an unread run is a better answer to
   * "where should I be" than a remembered position, and the jump above has
   * already given it. Guarded by the same `jumped` latch so exactly one of
   * the two ever runs.
   */
  useEffect(() => {
    if (jumped.current || unreadCount >= JUMP_TO_UNREAD_FROM || messages.length === 0) return;
    const saved = scrollMemory.get(bookId) ?? 0;
    if (saved < AWAY_FROM_BOTTOM) return; // near the end already; nothing to restore
    jumped.current = true;
    setTimeout(() => list.current?.scrollToOffset({ offset: saved, animated: false }), 220);
  }, [bookId, unreadCount, messages.length]);

  /**
   * Every keystroke: keep the draft, and tell the other phone.
   *
   * `signalTyping` throttles itself, so calling it per character is cheaper
   * than it looks — and emptying the field says so explicitly rather than
   * leaving their indicator to time out on its own.
   */
  const onType = (next: string) => {
    setText(next);
    // An edit in progress is not a draft: saving it would mean a half-fixed
    // old message reappearing in the box next time the thread is opened.
    if (!editingId) setChatDraft(bookId, next);
    if (next.trim()) signalTyping();
    else signalStoppedTyping();
  };

  const stopEditing = () => {
    setEditingId(null);
    setText('');
  };

  /** Still inside the window in which a message of yours may be corrected. */
  const editable = (message: SharedMessage) =>
    message.sender_id === me &&
    !message.deleted_at &&
    Date.now() - new Date(message.created_at).getTime() < EDIT_WINDOW_MS;

  const beginEdit = (message: SharedMessage) => {
    setReplyToId(null);
    setAttachedId(null);
    // The edit replaces the drafted reminder in the box, so the tag goes too —
    // otherwise the next ordinary message would quietly go out as a reminder.
    setAsReminder(false);
    setEditingId(message.id);
    setText(message.body);
  };

  /**
   * How far one message has got.
   *
   * Shared by the tick on the bubble and the info sheet, so the two can never
   * disagree about a message — which, for the one screen whose job is to
   * explain the tick, would be the worst possible bug.
   */
  const deliveryOf = (message: SharedMessage): DeliveryState => {
    if (pending.has(message.id)) {
      return Date.now() - new Date(message.created_at).getTime() > STUCK_AFTER_MS
        ? 'stuck'
        : 'pending';
    }
    if (theirs.read && message.created_at <= theirs.read) return 'read';
    if (theirs.delivered && message.created_at <= theirs.delivered) return 'delivered';
    return 'sent';
  };

  const send = () => {
    const body = text.trim();

    // Correcting something already said, rather than saying something new.
    // An emptied box cancels rather than blanking the message: deleting is
    // its own action, with its own warning.
    if (editingId) {
      if (body) editSharedMessage(editingId, body);
      stopEditing();
      signalStoppedTyping();
      return;
    }

    if (!body && !attachedId) return;
    addSharedMessage({
      bookId,
      body,
      entryId: attachedId,
      replyTo: replyToId,
      kind: asReminder ? 'reminder' : null,
    });
    setText('');
    setChatDraft(bookId, '');
    setAttachedId(null);
    setReplyToId(null);
    setAsReminder(false);
    // The moment the message lands, an indicator still saying "typing…" above
    // it reads as a second message that never comes.
    signalStoppedTyping();
    // Index 0 is the newest in an inverted list, so this is the bottom.
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const openEntry = (entryId: string) =>
    router.push(`/shared-entry?id=${encodeURIComponent(entryId)}` as Href);

  /**
   * Turn a message that mentions money into the entry it is describing.
   *
   * The form opens filled in rather than saved: the amount is a guess from a
   * sentence, and who paid is a guess from who typed it. Both are usually
   * right and neither should be acted on without being seen.
   */
  const recordAmount = (message: SharedMessage, amount: number) =>
    router.push(
      `/shared-entry?book=${encodeURIComponent(bookId)}` +
        `&payer=${encodeURIComponent(message.sender_id)}` +
        `&amount=${encodeURIComponent(String(amount))}` +
        `&note=${encodeURIComponent(message.body.trim().slice(0, 80))}` as Href
    );

  /**
   * Clear the balance in one go.
   *
   * Records the entry that cancels it — the person who OWES is the one who
   * pays — and then says so in the thread, quoting that entry. Both halves
   * matter: the ledger needs the row, and the conversation needs to show
   * where the number went, or the next scroll back is a mystery.
   */
  const settleUp = () => {
    const amount = Math.abs(balance);
    if (amount < 0.005 || !otherId) return;
    const youAreOwed = balance > 0;

    confirm({
      title: 'Settle up?',
      message: youAreOwed
        ? `Records that ${theirLabel} paid you ${formatMoney(amount)}, bringing the book to zero.`
        : `Records that you paid ${theirLabel} ${formatMoney(amount)}, bringing the book to zero.`,
      confirmLabel: 'Record it',
      onConfirm: () => {
        const entryId = addSharedEntry({
          bookId,
          payerId: youAreOwed ? otherId : me,
          amount,
          note: 'Settled up',
        });
        addSharedMessage({ bookId, body: `Settled up — ${formatMoney(amount)}`, entryId });
        list.current?.scrollToOffset({ offset: 0, animated: true });
      },
    });
  };

  /**
   * Scroll to a message, half way up the screen.
   *
   * Not at an edge: the message you were reading should still be in view above
   * it, so the jump reads as context rather than as having lost your place.
   */
  const goToMessage = (id: string) => {
    const index = messages.findIndex((message) => message.id === id);
    if (index < 0) return;
    list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  };

  const goToLatest = () => list.current?.scrollToOffset({ offset: 0, animated: true });

  /** The oldest message. Inverted, so the start of the thread is the end. */
  const goToStart = () => {
    if (messages.length === 0) return;
    list.current?.scrollToIndex({
      index: messages.length - 1,
      animated: true,
      viewPosition: 0.9,
    });
  };

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** The chosen messages, oldest first — the order anything built from them wants. */
  const selectedMessages = () =>
    thread.filter((message) => selected.has(message.id));

  const shareSelected = () => {
    const body = selectedMessages()
      .filter((message) => !message.deleted_at && message.body.trim())
      .map((message) => message.body.trim())
      .join('\n\n');
    setSelected(new Set());
    if (!body) return;
    void Share.share({ message: body }).catch(() => {
      // Dismissed, or nothing accepted it.
    });
  };

  const starSelected = () => {
    // All on, unless they already all are — then it is a way to clear them.
    const ids = [...selected];
    const turnOff = ids.every((id) => starred.has(id));
    for (const id of ids) setMessageStarred(id, !turnOff);
    setSelected(new Set());
  };

  const deleteSelected = () => {
    const ids = [...selected];
    confirm({
      title: ids.length === 1 ? 'Delete for everyone?' : `Delete ${ids.length} messages?`,
      message: otherName
        ? `They are removed from your device and ${otherName}’s. You will both still see that a message was deleted.`
        : 'They are removed from both devices. A line saying a message was deleted stays in each place.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        for (const id of ids) deleteSharedMessage(id);
        setSelected(new Set());
      },
    });
  };

  // --- Search, and the starred stepper that reuses it -----------------------
  // Steps between hits rather than filtering the thread down to them: an
  // answer you can't see in context is usually the wrong answer, and "what did
  // we say about the gas bill" is a question about the conversation around it.

  const matches = useMemo(() => {
    if (starredOnly) {
      return messages.filter((message) => starred.has(message.id)).map((message) => message.id);
    }
    const needle = query.trim().toLowerCase();
    if (!needle) return [] as string[];
    return messages
      .filter((message) => !message.deleted_at && message.body.toLowerCase().includes(needle))
      .map((message) => message.id);
  }, [messages, query, starredOnly, starred]);

  const activeMatch = matches[matchIndex] ?? null;

  // A new search starts at the newest hit; stepping moves from there. Both end
  // in the same place, so the jump lives here rather than in each handler.
  useEffect(() => {
    if (activeMatch) goToMessage(activeMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch]);

  const stepMatch = (delta: number) => {
    if (matches.length === 0) return;
    setMatchIndex((current) => (current + delta + matches.length) % matches.length);
  };

  const closeFinder = () => {
    setSearchOpen(false);
    setStarredOnly(false);
    setQuery('');
    setMatchIndex(0);
  };

  // --- Book settings --------------------------------------------------------

  /** Everything that writes to the book shares one failure message. */
  const tryBookWrite = (work: Promise<unknown>) =>
    void work.catch((error: unknown) =>
      notify(
        'Couldn’t change that',
        error instanceof Error ? error.message : 'Please try again when you’re online.'
      )
    );

  const chooseExpiry = (seconds: number) => {
    if (seconds === expireAfter) return;
    tryBookWrite(setSharedBookExpiry(bookId, seconds));
  };

  const pinMessage = (id: string | null) => tryBookWrite(setSharedBookPin(bookId, id));

  /**
   * The vanishing session, as a three-step handshake: ask, agree, end.
   *
   * Ending clears what was said straight away rather than waiting for either
   * of you to leave — turning it off IS leaving, as far as those messages are
   * concerned.
   */
  const inviteVanish = () => tryBookWrite(setSharedBookVanish(bookId, `ask:${me}`));
  const acceptVanish = () => tryBookWrite(setSharedBookVanish(bookId, 'on'));
  const clearVanish = () => tryBookWrite(setSharedBookVanish(bookId, ''));
  const endVanish = () => {
    clearVanish();
    purgeVanishedMessages(bookId, me);
  };

  /**
   * The thread as text, for anywhere that isn't this app.
   *
   * Vanishing messages are left out by `buildTranscript`, and that is not an
   * oversight: an export is the most durable copy there is, and a promise you
   * could export your way around would not be worth making.
   */
  const exportChat = () => {
    const transcript = buildTranscript({
      bookName: book?.name?.trim() || 'Shared book',
      messages: thread,
      nameFor: (senderId) => (senderId === me ? 'You' : theirLabel),
      entryFor: (entryId) => entriesById.get(entryId) ?? null,
      me,
    });
    if (!transcript) {
      notify('Nothing to export', 'There are no messages in this chat yet.');
      return;
    }
    void Share.share({ message: transcript }).catch(() => {
      // Dismissed, or nothing accepted it.
    });
  };

  const forwardTo = (target: SharedBook) => {
    const ids = forwardIds ?? [];
    setForwardIds(null);
    setSelected(new Set());
    if (ids.length === 0) return;

    // The words only, and in the order they were said. The entry a message
    // quotes belongs to the book it was said in, so a quote of it somewhere
    // else would point at nothing.
    const bodies = thread
      .filter((message) => ids.includes(message.id) && !message.deleted_at)
      .map((message) => message.body.trim())
      .filter(Boolean);
    for (const body of bodies) addSharedMessage({ bookId: target.id, body });
    notify(
      bodies.length === 1 ? 'Forwarded' : `Forwarded ${bodies.length} messages`,
      `Sent to ${target.name?.trim() || 'the other book'}.`
    );
  };

  /**
   * Put the nudge in the box rather than sending it.
   *
   * A reminder about money is the single most delicate message this app will
   * ever help anyone write, and the wording that works between two particular
   * people is not something a template knows. So it writes the figure and the
   * opening, and hands the sentence back for you to finish or soften.
   */
  const composeReminder = () => {
    const amount = Math.abs(balance);
    if (amount < 0.005) {
      notify('Nothing outstanding', 'This book is already settled up.');
      return;
    }
    const line =
      balance > 0
        ? `Hey — there’s ${formatMoney(amount)} pending from the book whenever you get a chance 🙂`
        : `Just so it’s not forgotten: I owe you ${formatMoney(amount)} from the book.`;
    setEditingId(null);
    setText(line);
    setChatDraft(bookId, line);
    setAsReminder(true);
  };

  const clearChat = () =>
    confirm({
      title: 'Clear this chat?',
      // The honest version. "Delete chat" would imply it goes everywhere.
      message: otherName
        ? `Removes every message from THIS device only. ${otherName} keeps their copy, and nothing is deleted from the server.`
        : 'Removes every message from this device only. Nothing is deleted from the server.',
      confirmLabel: 'Clear it',
      destructive: true,
      onConfirm: () => {
        clearSharedChatLocally(bookId);
        setSelected(new Set());
      },
    });

  /**
   * Put the badge back and get out of the way.
   *
   * Leaving is the point: this screen marks the thread read on focus, so
   * staying here would undo it on the very next render.
   */
  const markUnread = () => {
    if (!markBookUnread(bookId, me)) {
      notify('Nothing to mark', 'There are no messages from them to leave unread.');
      return;
    }
    router.back();
  };

  // --- Long-press actions ---------------------------------------------------

  const messageActions = (message: SharedMessage): SheetAction[] => {
    const actions: SheetAction[] = [];
    const standing = !message.deleted_at;
    const mine = message.sender_id === me;
    const canEdit = editable(message);

    // The same thing the swipe does. Here as well because a swipe is a gesture
    // you have to already know about, and because it is the only way in for
    // anyone driving the screen with a screen reader.
    if (standing) {
      actions.push({ label: 'Reply', icon: 'reply', onPress: () => setReplyToId(message.id) });
    }
    if (canEdit) {
      actions.push({ label: 'Edit', icon: 'edit', onPress: () => beginEdit(message) });
    }
    // A vanishing message is not pinnable: the pin would outlive the words
    // and leave a bar at the top of the thread pointing at nothing.
    if (standing && !message.vanish_at) {
      actions.push({
        label: pinnedId === message.id ? 'Unpin' : 'Pin to the top',
        icon: 'push-pin',
        onPress: () => pinMessage(pinnedId === message.id ? null : message.id),
      });
    }
    if (standing) {
      actions.push({
        label: starred.has(message.id) ? 'Remove from starred' : 'Star it',
        icon: starred.has(message.id) ? 'star' : 'star-outline',
        onPress: () => setMessageStarred(message.id, !starred.has(message.id)),
      });
    }

    if (standing) {
      actions.push({
        label: 'Select',
        icon: 'checklist',
        onPress: () => setSelected(new Set([message.id])),
      });
    }
    actions.push({
      label: 'Message info',
      icon: 'info-outline',
      onPress: () => setTimeout(() => setInfoFor(message), 220),
    });

    const quoted = message.entry_id ? entriesById.get(message.entry_id) : undefined;
    if (quoted) {
      actions.push({
        label: 'Open this entry',
        icon: 'receipt-long',
        onPress: () => openEntry(quoted.id),
      });
    }

    // A vanishing message is deliberately offered neither way out of the app.
    // The whole promise is that it leaves no copy behind.
    if (standing && message.body.trim() && !message.vanish_at) {
      actions.push({
        label: 'Forward',
        icon: 'forward',
        onPress: () => setForwardIds([message.id]),
      });
      actions.push({
        label: 'Share text',
        icon: 'share',
        onPress: () => {
          void Share.share({ message: message.body.trim() }).catch(() => {
            // The user dismissed the sheet, or no target accepted it.
          });
        },
      });
    }

    if (mine) {
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

  const finderOpen = searchOpen || starredOnly;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: otherName ?? book.name ?? 'Chat',
          // The balance rides under the name rather than taking a row of the
          // thread. Left off while a vanishing session runs: that is a moment
          // for talking, not for being handed a bill.
          headerTitle: () => (
            <ChatHeaderTitle
              title={otherName ?? book.name ?? 'Chat'}
              balance={vanish.mode !== 'on' && !!otherId ? balance : undefined}
              theirName={theirLabel}
              onSettle={settleUp}
            />
          ),
          headerRight: () => (
            <View style={styles.headerRow}>
              <Pressable
                onPress={() => (finderOpen ? closeFinder() : setSearchOpen(true))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Search this chat">
                <MaterialIcons name="search" size={22} color={theme.text} />
              </Pressable>
              <Pressable
                onPress={() => setMenuOpen(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Chat options">
                <MaterialIcons
                  // The icon carries whichever of these is true, in the order
                  // that matters most: a thread that erases itself should say
                  // so from the title bar, not only once a menu is opened.
                  name={
                    vanish.mode === 'on'
                      ? 'visibility-off'
                      : expireAfter > 0
                        ? 'timer'
                        : muted
                          ? 'notifications-off'
                          : 'more-vert'
                  }
                  size={22}
                  color={vanish.mode === 'on' || expireAfter > 0 ? theme.accentTint : theme.text}
                />
              </Pressable>
            </View>
          ),
        }}
      />
      {/* No <KeyboardAvoidingView>. It pads by the keyboard event's `screenY`,
          which Android takes from the window's visible frame — and under
          edge-to-edge that frame no longer shrinks when the keyboard opens, so
          it reports the keyboard as covering nothing. It also needs a
          header-sized correction on top of that.

          <ChatComposer> lifts itself by the keyboard's reported height, which
          comes off the IME window inset and holds either way. Its margin takes
          that height from the thread above, so the newest message stays above
          the bar rather than behind it.

          No bottom safe-area edge here either: the composer applies that inset
          itself, so the bar reaches the screen edge rather than floating. */}
      <View style={styles.flex}>
        <View style={styles.sheetWidth}>
          {!selecting && finderOpen && (
            <ChatSearchBar
              value={query}
              onChangeText={(next) => {
                setQuery(next);
                setMatchIndex(0);
              }}
              label={starredOnly ? 'Starred messages' : undefined}
              total={matches.length}
              position={matches.length === 0 ? 0 : matchIndex + 1}
              onPrev={() => stepMatch(1)}
              onNext={() => stepMatch(-1)}
              onClose={closeFinder}
            />
          )}

          {selecting && (
            <ChatSelectionBar
              count={selected.size}
              onStar={starSelected}
              onForward={() => setForwardIds([...selected])}
              onShare={shareSelected}
              onDelete={allMine ? deleteSelected : undefined}
              onClose={() => setSelected(new Set())}
            />
          )}

          {!selecting && !finderOpen && pinnedId && (
            <ChatPinnedBar
              message={pinned}
              authorLabel={authorOf(pinned)}
              onPress={() => goToMessage(pinnedId)}
              onClear={() => pinMessage(null)}
            />
          )}

          {!selecting && vanish.mode !== 'off' && (
            <ChatVanishBanner
              mode={vanish.mode}
              askedByMe={vanish.mode === 'asked' && vanish.by === me}
              theirName={theirLabel}
              onAccept={acceptVanish}
              onDecline={clearVanish}
              onCancel={clearVanish}
              onEnd={endVanish}
            />
          )}

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
            <View style={styles.flex}>
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
                // Inverted, so offset 0 is the newest message. Anything beyond
                // a screenful back means the latest is no longer in view.
                scrollEventThrottle={64}
                onScroll={(event) => {
                  offset.current = event.nativeEvent.contentOffset.y;
                  setAway(offset.current > AWAY_FROM_BOTTOM);
                }}
                // Bubbles are measured as they are drawn, so a jump to one that
                // has never been on screen has nothing to aim at. Estimate,
                // then correct once the rows around it have laid out.
                onScrollToIndexFailed={(info) => {
                  list.current?.scrollToOffset({
                    offset: info.averageItemLength * info.index,
                    animated: true,
                  });
                  setTimeout(() => {
                    list.current?.scrollToIndex({
                      index: info.index,
                      animated: true,
                      viewPosition: 0.5,
                    });
                  }, 140);
                }}
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
                  // The message this one answers. The id is kept even when that
                  // message has gone, so the quote can say so rather than the
                  // reply quietly losing what it was about.
                  const answers = gone ? null : item.reply_to;
                  const answered = answers ? (messagesById.get(answers) ?? null) : null;
                  // Anything still standing can be answered, so the sheet always
                  // has at least that. One already taken back has nothing.
                  const hasActions = !gone;
                  // Money worth recording — but not on a message that is already
                  // about an entry, where the figure is the one being discussed
                  // rather than a new one to add.
                  const money = gone || item.entry_id ? null : findAmountInText(item.body);
                  // The oldest message you hadn't seen when you walked in.
                  const firstUnread =
                    unreadCount > 0 &&
                    !mine &&
                    item.created_at > readUpTo.current &&
                    (!older || older.created_at <= readUpTo.current);

                  // A clock that never becomes a tick is indistinguishable
                  // from an app that has quietly stopped working.
                  const delivery = deliveryOf(item);

                  return (
                    <>
                      <ChatBubble
                        body={item.body}
                        time={item.created_at}
                        mine={mine}
                        grouped={!newDay && older?.sender_id === item.sender_id}
                        deleted={gone}
                        delivery={mine ? delivery : undefined}
                        expiring={!!item.expires_at}
                        vanishing={!!item.vanish_at}
                        edited={!!item.edited_at}
                        reminder={item.kind === 'reminder'}
                        starred={starred.has(item.id)}
                        highlight={item.id === activeMatch}
                        selected={selected.has(item.id)}
                        onToggleSelect={selecting ? () => toggleSelected(item.id) : undefined}
                        onLongPress={
                          selecting
                            ? () => toggleSelected(item.id)
                            : hasActions
                              ? () => setSheetFor(item)
                              : undefined
                        }
                        onSwipeReply={
                          gone || selecting ? undefined : () => setReplyToId(item.id)
                        }
                        onSwipeEdit={
                          gone || selecting || !mine || !editable(item)
                            ? undefined
                            : () => beginEdit(item)
                        }
                        onDoubleTap={
                          gone || selecting
                            ? undefined
                            : () =>
                                setSharedReaction(
                                  bookId,
                                  item.id,
                                  myReactionTo(item.id) === DOUBLE_TAP_EMOJI
                                    ? ''
                                    : DOUBLE_TAP_EMOJI
                                )
                        }
                        onRetry={() => void refreshShared()}
                        replyQuote={
                          answers ? (
                            <ChatReplyQuote
                              message={answered}
                              authorLabel={authorOf(answered)}
                              onTint={mine}
                              onPress={answered ? () => goToMessage(answered.id) : undefined}
                            />
                          ) : undefined
                        }
                        quote={
                          item.entry_id && !gone ? (
                            <ChatEntryQuote
                              entry={quoted}
                              youPaid={quoted?.payer_id === me}
                              payerName={theirLabel}
                              edited={!!quoted && editedEntries.has(quoted.id)}
                              onTint={mine}
                              onPress={quoted ? () => openEntry(quoted.id) : undefined}
                            />
                          ) : undefined
                        }
                        footer={
                          money ? (
                            <ChatAmountAction
                              amount={money.amount}
                              onTint={mine}
                              onPress={() => recordAmount(item, money.amount)}
                            />
                          ) : undefined
                        }
                        reactions={
                          <ChatReactions
                            reactions={reactionsByMessage.get(item.id) ?? []}
                            mine={mine}
                            onPress={() => setSheetFor(item)}
                          />
                        }
                      />
                      {/* After the bubble in source, above it on screen — so
                          the day reads above the mark, and both above the
                          first message either of them is about. */}
                      {firstUnread && <ChatUnreadMark count={unreadCount} />}
                      {newDay && <ChatDay day={day} />}
                    </>
                  );
                }}
              />

              {away && (
                <ChatJump
                  count={unreadCount}
                  onPress={() => {
                    goToLatest();
                    setAway(false);
                  }}
                />
              )}
            </View>
          )}

          {/* Their dots, exactly where the message they are writing will land. */}
          {peerTyping && <ChatTyping />}

          <ChatComposer
            value={text}
            onChangeText={onType}
            onSend={send}
            editing={!!editingId}
            onCancelEdit={stopEditing}
            banner={
              asReminder && !editingId ? (
                <ChatReminderTag onRemove={() => setAsReminder(false)} />
              ) : expireAfter > 0 && vanish.mode !== 'on' ? (
                <ChatNotice
                  icon="timer"
                  text={`Messages disappear after ${expiryLabel(expireAfter).toLowerCase()}`}
                />
              ) : undefined
            }
            onAttachLongPress={() => {
              // The entry being talked about is nearly always the last one
              // recorded, so holding the button skips the choice entirely.
              const newest = entries[0];
              if (!newest) return;
              Keyboard.dismiss();
              setAttachedId(newest.id);
            }}
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
                  edited={!!attached && editedEntries.has(attached.id)}
                  onRemove={() => setAttachedId(null)}
                />
              ) : undefined
            }
            reply={
              replyToId ? (
                <ChatReplyQuote
                  message={replyTo}
                  authorLabel={authorOf(replyTo)}
                  onRemove={() => setReplyToId(null)}
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
        header={
          sheetFor && !sheetFor.deleted_at ? (
            <ReactionBar
              chosen={myReactionTo(sheetFor.id)}
              onPick={(emoji) => {
                setSharedReaction(bookId, sheetFor.id, emoji);
                setSheetFor(null);
              }}
              onMore={() => {
                const id = sheetFor.id;
                setSheetFor(null);
                // One sheet at a time: Android will not open a second modal
                // while the first is still dismissing.
                setTimeout(() => setReactFor(id), 220);
              }}
            />
          ) : undefined
        }
        actions={sheetFor ? messageActions(sheetFor) : []}
        onClose={() => setSheetFor(null)}
      />

      <EmojiPickerSheet
        visible={reactFor !== null}
        onPick={(emoji) => {
          if (reactFor) setSharedReaction(bookId, reactFor, emoji);
          setReactFor(null);
        }}
        onClose={() => setReactFor(null)}
      />

      <BookPickerSheet
        visible={forwardIds !== null}
        books={otherBooks}
        title={
          forwardIds && forwardIds.length > 1
            ? `Forward ${forwardIds.length} messages to`
            : 'Forward to'
        }
        onPick={forwardTo}
        onClose={() => setForwardIds(null)}
      />

      <MessageInfoSheet
        visible={infoFor !== null}
        message={infoFor}
        delivery={infoFor ? deliveryOf(infoFor) : 'sent'}
        authorLabel={authorOf(infoFor)}
        onClose={() => setInfoFor(null)}
      />

      <ActionSheet
        visible={menuOpen}
        title="Chat"
        actions={[
          {
            label:
              vanish.mode === 'on'
                ? 'End the vanishing chat'
                : vanish.mode === 'asked'
                  ? 'Cancel the vanishing invitation'
                  : 'Start a vanishing chat',
            icon: 'visibility-off',
            onPress:
              vanish.mode === 'on'
                ? endVanish
                : vanish.mode === 'asked'
                  ? clearVanish
                  : inviteVanish,
          },
          {
            label: `Disappearing messages · ${expiryLabel(expireAfter)}`,
            icon: 'timer',
            // One sheet at a time: the menu is still dismissing on the frame
            // <ActionSheet> runs this, and Android will not open a second
            // modal underneath it.
            onPress: () => setTimeout(() => setExpiryOpen(true), 220),
          },
          {
            label: 'Starred messages',
            icon: 'star-outline',
            onPress: () => {
              setSearchOpen(false);
              setQuery('');
              setMatchIndex(0);
              setStarredOnly(true);
            },
          },
          {
            label: 'Search this chat',
            icon: 'search',
            onPress: () => {
              setStarredOnly(false);
              setSearchOpen(true);
            },
          },
          {
            label: 'Send a balance reminder',
            icon: 'notifications-active',
            onPress: composeReminder,
          },
          {
            label: 'Go to the first message',
            icon: 'vertical-align-top',
            onPress: goToStart,
          },
          {
            label: 'Mark as unread',
            icon: 'mark-chat-unread',
            onPress: markUnread,
          },
          {
            label: muted ? 'Unmute notifications' : 'Mute notifications',
            icon: muted ? 'notifications' : 'notifications-off',
            onPress: () => setBookMuted(bookId, !muted),
          },
          { label: 'Export this chat', icon: 'share', onPress: exportChat },
          {
            label: 'Clear this chat',
            icon: 'delete-sweep',
            destructive: true,
            onPress: () => setTimeout(clearChat, 220),
          },
          {
            label: 'Open the book',
            icon: 'menu-book',
            onPress: () => router.push(`/shared-book?id=${encodeURIComponent(bookId)}` as Href),
          },
        ]}
        onClose={() => setMenuOpen(false)}
      />

      <ActionSheet
        visible={expiryOpen}
        title="Disappear after"
        actions={EXPIRY_CHOICES.map((choice) => ({
          label: choice.seconds === expireAfter ? `${choice.label}  ✓` : choice.label,
          icon: choice.seconds === 0 ? 'timer-off' : 'timer',
          onPress: () => chooseExpiry(choice.seconds),
        }))}
        onClose={() => setExpiryOpen(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
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
