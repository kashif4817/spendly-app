/**
 * The chat kit for a shared book.
 *
 * A shared book answers "where does this leave us"; the thread answers "what
 * was that one for". So the pieces here are deliberately the smaller, quieter
 * cousins of the statement kit next door: the same glass, the same money
 * colours, the same arrow that says which way the money went — at bubble
 * scale, because a conversation is read in runs rather than scanned row by row.
 *
 * Everything a message can contain lives in this file so the screen stays
 * about the thread: who said what, in what order, and whether it has landed.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  FlatList,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dropLastGrapheme, EmojiPanel } from '@/components/emoji-picker';
import { StatementDay } from '@/components/statement';
import { ThemedText } from '@/components/themed-text';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import type { SharedBook, SharedEntry, SharedMessage } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime, formatRelativeDay, formatTime } from '@/lib/date';
import { linkify } from '@/lib/linkify';
import { formatMoney } from '@/lib/money';

/**
 * How far a message has got, and the tick that says so:
 *
 *   pending   — still in the outbox        ·  a clock
 *   stuck     — in the outbox far too long ·  a warning, tap to retry
 *   sent      — the server has it          ·  one tick
 *   delivered — their phone has it         ·  two ticks
 *   read      — they have opened the thread ·  two blue ticks
 *
 * `stuck` is not a different state on the wire — the outbox retries on every
 * sync regardless. It exists because a clock that never becomes a tick is
 * indistinguishable from an app that has quietly stopped working, and the
 * honest thing is to say so and offer the retry.
 */
export type DeliveryState = 'pending' | 'stuck' | 'sent' | 'delivered' | 'read';

/** How long a message may sit in the outbox before the clock becomes a warning. */
export const STUCK_AFTER_MS = 90_000;

/**
 * The read tick's blue.
 *
 * Fixed rather than taken from the theme, because it only ever sits on an
 * accent-filled bubble — which is a saturated colour in both themes, and the
 * light theme's azure would sink straight into it.
 */
const READ_TICK = '#7CC9FF';

/**
 * Swipe-to-reply, in numbers.
 *
 * ACTIVATE is how far across the finger must travel before the bubble starts
 * to follow it at all. It is deliberately larger than the vertical FAIL, so a
 * gesture that is even slightly more up-and-down than across belongs to the
 * list: a thread is scrolled far more often than it is replied to, and a
 * scroll that catches on a bubble is the worse failure of the two.
 *
 * TRIGGER is the point past which letting go opens a reply; MAX is where the
 * bubble stops moving, so there is a short dead zone after the trigger that
 * says "yes, this one" without the row sliding off the screen.
 */
/**
 * The six tap-backs offered without opening the picker.
 *
 * Six because that is what fits one row on the narrowest phone this app
 * supports, and because a reaction is meant to cost one tap — a grid would
 * make it cost two and a decision.
 */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const SWIPE_ACTIVATE = 18;
const SWIPE_FAIL_Y = 12;
const SWIPE_TRIGGER = 52;
const SWIPE_MAX = 76;

/**
 * The count pill on a chat button.
 *
 * Also used by the people list, which is why it lives here rather than in the
 * screen: one badge, so an unread four looks the same wherever you meet it.
 */
export function UnreadBadge({ count, style }: { count: number; style?: ViewStyle }) {
  const theme = useTheme();
  if (count <= 0) return null;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: theme.accent,
          // A bright ring rather than the card's own fill: every surface here
          // is translucent, so the badge would otherwise have no edge.
          borderColor: 'rgba(255,255,255,0.55)',
        },
        style,
      ]}
      accessibilityLabel={`${count} unread ${count === 1 ? 'message' : 'messages'}`}>
      <ThemedText style={styles.badgeText}>{count > 9 ? '9+' : count}</ThemedText>
    </View>
  );
}

/**
 * A message's words, with the tappable parts tappable.
 *
 * The first real conversation this chat carried was two people swapping a
 * GitHub link, and it sat there as dead text while one of them retyped it
 * into a browser. Links, emails and phone numbers now open where they should.
 *
 * Nested <Text> rather than a row of views: only nested text wraps as one
 * paragraph, and a link broken across two lines has to stay one link.
 */
export function ChatText({
  body,
  onTint,
  style,
}: {
  body: string;
  /** On an accent-filled bubble, where the accent colour would disappear. */
  onTint?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  const parts = useMemo(() => linkify(body), [body]);

  const open = (url: string) => {
    void Linking.openURL(url).catch(() => {
      // No app for that scheme, or the user backed out of the chooser.
    });
  };

  // The overwhelmingly common case: nothing tappable, so no extra nodes.
  if (parts.length === 1 && parts[0].kind === 'text') {
    return (
      <ThemedText type="small" style={style}>
        {body}
      </ThemedText>
    );
  }

  const linkStyle = {
    color: onTint ? '#ffffff' : theme.accentTint,
    textDecorationLine: 'underline' as const,
  };

  return (
    <ThemedText type="small" style={style}>
      {parts.map((part, index) =>
        part.kind === 'text' ? (
          part.text
        ) : (
          <ThemedText
            key={`${part.url}-${index}`}
            type="small"
            style={[style, linkStyle]}
            onPress={() => open(part.url)}
            accessibilityRole="link">
            {part.text}
          </ThemedText>
        )
      )}
    </ThemedText>
  );
}

/**
 * A thin line across the thread that the thread is saying about itself.
 *
 * Used for the disappearing-messages notice. Deliberately NOT a message: a
 * setting is not something either person said, and putting it in a bubble
 * would make it quotable, repliable and deletable — none of which make sense
 * for a fact about the book.
 */
export function ChatNotice({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  text: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.noticeRow}>
      <View style={[styles.noticeChip, theme.glassWeak]}>
        <MaterialIcons name={icon} size={13} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.dayText}>
          {text}
        </ThemedText>
      </View>
    </View>
  );
}

/**
 * Where you had read up to when you opened the thread.
 *
 * Fixed at open rather than live: a divider that crept down the screen as you
 * read would never let you see what you had missed, which is the only thing
 * it is for.
 */
export function ChatUnreadMark({ count }: { count: number }) {
  const theme = useTheme();
  return (
    <View style={styles.unreadRow}>
      <View style={[styles.unreadRule, { backgroundColor: theme.accentTint }]} />
      <ThemedText type="small" style={[styles.unreadText, { color: theme.accentTint }]}>
        {count === 1 ? '1 new message' : `${count} new messages`}
      </ThemedText>
      <View style={[styles.unreadRule, { backgroundColor: theme.accentTint }]} />
    </View>
  );
}

/**
 * "… is typing", as the three dots every chat app has trained people to read.
 *
 * A bubble on their side of the thread rather than a line under the title:
 * the dots then appear exactly where the message they are writing will, which
 * is the whole illusion.
 */
export function ChatTyping() {
  const theme = useTheme();
  const one = useRef(new Animated.Value(0)).current;
  const two = useRef(new Animated.Value(0)).current;
  const three = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const bounce = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(240 - delay),
        ])
      );

    const all = Animated.parallel([bounce(one, 0), bounce(two, 120), bounce(three, 240)]);
    all.start();
    // Stopped rather than left running: this unmounts the moment they stop
    // typing, and a loop that outlived its view would keep a frame callback
    // alive for the rest of the session.
    return () => all.stop();
  }, [one, two, three]);

  const dot = (value: Animated.Value) => (
    <Animated.View
      style={[
        styles.typingDot,
        {
          backgroundColor: theme.textSecondary,
          opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
          transform: [
            { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) },
          ],
        },
      ]}
    />
  );

  return (
    <View style={styles.typingRow} accessibilityLabel="Typing">
      <View style={[styles.typingBubble, theme.glass]}>
        {dot(one)}
        {dot(two)}
        {dot(three)}
      </View>
    </View>
  );
}

/**
 * The tap-backs on one message, as pills under it.
 *
 * Counted rather than listed: a book has two people in it, so a count is
 * either 1 or 2 and the pill stays the same width either way. Yours is ringed
 * so you can tell at a glance which one you left.
 */
export function ChatReactions({
  reactions,
  mine,
  onPress,
}: {
  reactions: { emoji: string; count: number; byMe: boolean }[];
  /** The bubble above is yours, so the pills hang from its right edge. */
  mine: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  if (reactions.length === 0) return null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.reactionRow,
        mine ? styles.reactionRowMine : styles.reactionRowTheirs,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Reactions: ${reactions.map((r) => r.emoji).join(' ')}`}>
      {reactions.map((reaction) => (
        <View
          key={reaction.emoji}
          style={[
            styles.reactionPill,
            theme.glassStrong,
            reaction.byMe && { borderColor: theme.accentTint, borderWidth: 1 },
          ]}>
          <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
          {reaction.count > 1 && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.reactionCount}>
              {reaction.count}
            </ThemedText>
          )}
        </View>
      ))}
    </Pressable>
  );
}

/**
 * The row of tap-backs in the long-press sheet.
 *
 * Tapping the one you already left takes it back, which is why the chosen one
 * is filled rather than merely marked: it has to look like a thing you can
 * press again.
 */
export function ReactionBar({
  chosen,
  onPick,
  onMore,
}: {
  /** The emoji you have already left on this message, if any. */
  chosen: string | null;
  onPick: (emoji: string) => void;
  onMore: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.quickRow, theme.glass]}>
      {QUICK_REACTIONS.map((emoji) => {
        const on = chosen === emoji;
        return (
          <Pressable
            key={emoji}
            onPress={() => onPick(on ? '' : emoji)}
            style={({ pressed }) => [
              styles.quickKey,
              on && { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={on ? `Remove ${emoji}` : `React with ${emoji}`}>
            <Text style={styles.quickEmoji}>{emoji}</Text>
          </Pressable>
        );
      })}
      <Pressable
        onPress={onMore}
        style={({ pressed }) => [styles.quickKey, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Pick another emoji">
        <MaterialIcons name="add" size={20} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

/**
 * "Add PKR 4,500 as an entry", under a message that mentioned money.
 *
 * THE ONE THING A GENERAL CHAT APP CANNOT DO. Everywhere else, "I paid 4,500
 * for the gas" is where the record stops and somebody has to retype the
 * number into something else later. Here the thread sits beside the book it
 * is about, so the sentence can become the entry it is describing.
 *
 * A suggestion, never an action: it opens the entry form with the amount and
 * the sentence filled in, and nothing is recorded until that form is saved.
 */
export function ChatAmountAction({
  amount,
  onTint,
  onPress,
}: {
  amount: number;
  onTint?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink = onTint ? '#ffffff' : theme.accentTint;
  const surface: ViewStyle = onTint
    ? { backgroundColor: 'rgba(255,255,255,0.18)' }
    : theme.glassWeak;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.amountAction, surface, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Record ${formatMoney(amount)} as an entry in this book`}>
      <MaterialIcons name="add-circle-outline" size={15} color={ink} />
      <ThemedText type="smallBold" style={[styles.amountActionText, { color: ink }]} numberOfLines={1}>
        Add {formatMoney(amount)} as an entry
      </ThemedText>
    </Pressable>
  );
}

/**
 * Back to the newest message, with what you would be skipping.
 *
 * Only worth showing once the thread has actually moved away under you, which
 * the screen decides — a button that is always there is just furniture.
 */
export function ChatJump({ count, onPress }: { count: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.jumpWrap} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.jumpBtn, theme.glassOverlay, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={
          count > 0 ? `${count} new below — go to the latest` : 'Go to the latest message'
        }>
        <MaterialIcons name="arrow-downward" size={20} color={theme.text} />
        {count > 0 && <UnreadBadge count={count} style={styles.jumpBadge} />}
      </Pressable>
    </View>
  );
}

/**
 * Find a message in this thread.
 *
 * Steps between hits rather than filtering the list down to them: an answer
 * you can't see in context is usually the wrong answer, and "what did we say
 * about the gas bill" is a question about the conversation around the match.
 */
export function ChatSearchBar({
  value,
  onChangeText,
  label,
  total,
  position,
  onPrev,
  onNext,
  onClose,
}: {
  value: string;
  onChangeText: (text: string) => void;
  /**
   * Shown instead of the field when the bar is stepping through a set that
   * wasn't typed — your starred messages. Same stepper, no search box,
   * because there is nothing to search for.
   */
  label?: string;
  total: number;
  /** 1-based index of the hit currently in view, or 0 when there are none. */
  position: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const none = label ? total === 0 : value.trim().length > 0 && total === 0;

  return (
    <View style={[styles.searchBar, theme.glassOverlay]}>
      <MaterialIcons name={label ? 'star' : 'search'} size={18} color={theme.textSecondary} />
      {label ? (
        <ThemedText type="smallBold" style={styles.searchInput} numberOfLines={1}>
          {label}
        </ThemedText>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Search this chat"
          placeholderTextColor={theme.textSecondary}
          style={[styles.searchInput, { color: theme.text }]}
          autoFocus
          returnKeyType="search"
          accessibilityLabel="Search this chat"
        />
      )}
      {(label || value.trim().length > 0) && (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={none ? styles.searchNone : undefined}>
          {none ? (label ? 'None yet' : 'No matches') : `${position}/${total}`}
        </ThemedText>
      )}
      <Pressable
        onPress={onPrev}
        disabled={total === 0}
        hitSlop={6}
        style={({ pressed }) => [total === 0 && styles.dim, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Previous match">
        <MaterialIcons name="keyboard-arrow-up" size={22} color={theme.text} />
      </Pressable>
      <Pressable
        onPress={onNext}
        disabled={total === 0}
        hitSlop={6}
        style={({ pressed }) => [total === 0 && styles.dim, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Next match">
        <MaterialIcons name="keyboard-arrow-down" size={22} color={theme.text} />
      </Pressable>
      <Pressable
        onPress={onClose}
        hitSlop={6}
        style={({ pressed }) => [pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Close search">
        <MaterialIcons name="close" size={20} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

/**
 * What became of one message, in full.
 *
 * The ticks already say sent / delivered / read at a glance; this is for the
 * moment that is not enough — "did they actually get it", usually asked when
 * something has gone quiet. Only the send time is a real timestamp: the
 * markers the other phone sends back say how far it has got, not when, and
 * inventing a time for them would be the kind of precision that is worse than
 * none.
 */
export function MessageInfoSheet({
  visible,
  message,
  delivery,
  authorLabel,
  onClose,
}: {
  visible: boolean;
  message: SharedMessage | null;
  delivery: DeliveryState;
  authorLabel: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  if (!message) return null;

  const reached =
    delivery === 'read'
      ? 'Read'
      : delivery === 'delivered'
        ? 'On their phone, not opened yet'
        : delivery === 'sent'
          ? 'With the server'
          : delivery === 'stuck'
            ? 'Still waiting to go — this device has not been able to reach the server'
            : 'Waiting to go';

  const rows: { label: string; value: string }[] = [
    { label: 'From', value: authorLabel },
    { label: 'Sent', value: formatDateTime(message.created_at) },
    { label: 'Status', value: reached },
  ];
  if (message.edited_at) rows.push({ label: 'Edited', value: formatDateTime(message.edited_at) });
  if (message.expires_at) {
    rows.push({ label: 'Disappears', value: formatDateTime(message.expires_at) });
  }
  if (message.vanish_at) {
    rows.push({ label: 'Vanishing', value: 'Goes when either of you leaves the chat' });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        <Pressable onPress={() => {}} style={styles.sheetWrap}>
          <View
            style={[
              styles.sheet,
              theme.glassOverlay,
              { paddingBottom: insets.bottom + Spacing.three },
            ]}>
            <View style={[styles.grabber, { backgroundColor: theme.backgroundSelected }]} />
            <ThemedText type="smallBold" style={styles.sheetTitle}>
              Message info
            </ThemedText>

            {rows.map((row) => (
              <View key={row.label} style={[styles.infoRow, theme.glass]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {row.label}
                </ThemedText>
                <ThemedText type="smallBold" style={styles.infoValue} numberOfLines={2}>
                  {row.value}
                </ThemedText>
              </View>
            ))}

            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
              accessibilityRole="button">
              <ThemedText type="smallBold" themeColor="textSecondary">
                Close
              </ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The bar that takes over the top of the thread while messages are chosen.
 *
 * It replaces the pinned bar and the balance strip rather than stacking on
 * top of them: while you are picking things out of the conversation, the
 * conversation's running total is not what you are looking at.
 */
export function ChatSelectionBar({
  count,
  onStar,
  onForward,
  onShare,
  onDelete,
  onClose,
}: {
  count: number;
  onStar: () => void;
  onForward: () => void;
  onShare: () => void;
  /** Omitted when the chosen set includes something that isn't yours. */
  onDelete?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.selectBar, theme.glassOverlay]}>
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Stop selecting">
        <MaterialIcons name="close" size={20} color={theme.text} />
      </Pressable>
      <ThemedText type="smallBold" style={styles.selectCount}>
        {count} selected
      </ThemedText>
      <Pressable onPress={onStar} hitSlop={8} accessibilityRole="button" accessibilityLabel="Star">
        <MaterialIcons name="star-outline" size={20} color={theme.text} />
      </Pressable>
      <Pressable
        onPress={onForward}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Forward">
        <MaterialIcons name="forward" size={20} color={theme.text} />
      </Pressable>
      <Pressable onPress={onShare} hitSlop={8} accessibilityRole="button" accessibilityLabel="Share">
        <MaterialIcons name="share" size={19} color={theme.text} />
      </Pressable>
      {onDelete && (
        <Pressable
          onPress={onDelete}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Delete">
          <MaterialIcons name="delete-outline" size={20} color={'#e5484d'} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * The one message held at the top of the thread.
 *
 * ONE, not a list. A wall of pins is the thread again, and the thing people
 * actually pin — "rent is due on the 5th", an account number, the address —
 * is a single fact they keep scrolling back for.
 */
export function ChatPinnedBar({
  message,
  authorLabel,
  onPress,
  onClear,
}: {
  /** Null when the pinned message has since gone; the bar then says so. */
  message: SharedMessage | null;
  authorLabel: string;
  onPress: () => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const preview = !message
    ? 'The pinned message is no longer here'
    : message.body.trim() || (message.entry_id ? 'Shared an entry' : 'Message');

  return (
    <Pressable
      onPress={message ? onPress : undefined}
      style={({ pressed }) => [styles.pinnedBar, theme.glassOverlay, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Pinned by ${authorLabel}. ${preview}`}>
      <MaterialIcons name="push-pin" size={15} color={theme.accentTint} />
      <View style={styles.pinnedBody}>
        <ThemedText type="small" style={[styles.pinnedWho, { color: theme.accentTint }]}>
          Pinned · {authorLabel}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {preview}
        </ThemedText>
      </View>
      <Pressable
        onPress={onClear}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Unpin this message">
        <MaterialIcons name="close" size={18} color={theme.textSecondary} />
      </Pressable>
    </Pressable>
  );
}

/**
 * Where the book stands, above the conversation about it.
 *
 * THE REASON THIS CHAT EXISTS IN THE FIRST PLACE is that the number and the
 * talk about the number were in two different apps. Putting the balance at
 * the top of the thread closes the last of that gap: you no longer have to
 * leave the conversation to remember what it is about.
 *
 * Tapping it settles up, which is the only thing anyone ever wants to do with
 * a balance that isn't zero.
 */
export function ChatBalanceStrip({
  balance,
  theirName,
  onSettle,
}: {
  /** Positive when you are owed; the sign is the whole message. */
  balance: number;
  theirName: string;
  onSettle: () => void;
}) {
  const theme = useTheme();
  const settled = Math.abs(balance) < 0.005;
  const youAreOwed = balance > 0;
  const color = settled ? theme.textSecondary : youAreOwed ? theme.money.in : theme.money.out;

  return (
    <View style={[styles.balanceStrip, theme.glassWeak]}>
      <MaterialIcons
        name={settled ? 'check-circle-outline' : youAreOwed ? 'call-made' : 'call-received'}
        size={15}
        color={color}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.balanceText} numberOfLines={1}>
        {settled
          ? 'All settled up'
          : youAreOwed
            ? `${theirName} owes you `
            : `You owe ${theirName} `}
        {!settled && (
          <ThemedText type="smallBold" style={{ color }}>
            {formatMoney(Math.abs(balance))}
          </ThemedText>
        )}
      </ThemedText>
      {!settled && (
        <Pressable
          onPress={onSettle}
          hitSlop={6}
          style={({ pressed }) => [styles.settleBtn, theme.glass, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Settle up ${formatMoney(Math.abs(balance))}`}>
          <ThemedText type="smallBold" style={{ color: theme.accentTint }}>
            Settle up
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The vanishing session: the invitation, and the state while it runs.
 *
 * AN INVITATION, NOT A SWITCH. This thread sits beside a shared ledger, so
 * "this conversation leaves no record" is a thing both people should have
 * agreed to — not something one of them discovers afterwards when they go
 * looking for what was said. One asks, the other answers, and either can end
 * it at any time.
 */
export function ChatVanishBanner({
  mode,
  askedByMe,
  theirName,
  onAccept,
  onDecline,
  onEnd,
  onCancel,
}: {
  mode: 'asked' | 'on';
  /** You are the one waiting for an answer, rather than the one being asked. */
  askedByMe: boolean;
  theirName: string;
  onAccept: () => void;
  onDecline: () => void;
  onEnd: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();

  if (mode === 'on') {
    return (
      <Pressable
        onPress={onEnd}
        style={({ pressed }) => [styles.vanishBar, theme.glassStrong, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Vanishing chat is on. Tap to end it.">
        <MaterialIcons name="visibility-off" size={16} color={theme.accentTint} />
        <View style={styles.vanishBody}>
          <ThemedText type="smallBold" style={{ color: theme.accentTint }}>
            Vanishing chat
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            What you both say now is gone when either of you leaves this screen.
          </ThemedText>
        </View>
        <ThemedText type="smallBold" themeColor="textSecondary">
          End
        </ThemedText>
      </Pressable>
    );
  }

  // Waiting on them.
  if (askedByMe) {
    return (
      <View style={[styles.vanishBar, theme.glassStrong]}>
        <MaterialIcons name="hourglass-empty" size={16} color={theme.textSecondary} />
        <View style={styles.vanishBody}>
          <ThemedText type="smallBold">Waiting for {theirName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            They will see your invitation to a vanishing chat next time they open this.
          </ThemedText>
        </View>
        <Pressable
          onPress={onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel the invitation">
          <ThemedText type="smallBold" themeColor="textSecondary">
            Cancel
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  // Being asked.
  return (
    <View style={[styles.vanishBar, theme.glassStrong]}>
      <MaterialIcons name="visibility-off" size={16} color={theme.accentTint} />
      <View style={styles.vanishBody}>
        <ThemedText type="smallBold">{theirName} wants a vanishing chat</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          Anything either of you sends while it runs disappears from both phones as
          soon as one of you leaves.
        </ThemedText>
        <View style={styles.vanishActions}>
          <Pressable
            onPress={onAccept}
            style={({ pressed }) => [
              styles.vanishBtn,
              { backgroundColor: theme.accent },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button">
            <ThemedText type="smallBold" style={styles.vanishBtnText}>
              Start it
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={onDecline}
            style={({ pressed }) => [styles.vanishBtn, theme.glass, pressed && styles.pressed]}
            accessibilityRole="button">
            <ThemedText type="smallBold" themeColor="textSecondary">
              No thanks
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * Which book to send this message on to.
 *
 * Forwarding re-sends the words rather than moving the row: the message
 * belongs to the conversation it was said in, and a copy in another book is a
 * new thing said there, with its own sender and its own time.
 */
export function BookPickerSheet({
  visible,
  books,
  title,
  onPick,
  onClose,
}: {
  visible: boolean;
  books: SharedBook[];
  title: string;
  onPick: (book: SharedBook) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        <Pressable onPress={() => {}} style={styles.sheetWrap}>
          <View
            style={[
              styles.sheet,
              theme.glassOverlay,
              { paddingBottom: insets.bottom + Spacing.three },
            ]}>
            <View style={[styles.grabber, { backgroundColor: theme.backgroundSelected }]} />
            <ThemedText type="smallBold" style={styles.sheetTitle}>
              {title}
            </ThemedText>

            <FlatList
              data={books}
              keyExtractor={(book) => book.id}
              style={[styles.sheetList, { maxHeight: Math.round(height * 0.46) }]}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    onClose();
                    onPick(item);
                  }}
                  style={({ pressed }) => [styles.pickRow, theme.glass, pressed && styles.pressed]}
                  accessibilityRole="button">
                  <MaterialIcons name="menu-book" size={16} color={theme.accentTint} />
                  <View style={styles.pickBody}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {item.name?.trim() || 'Shared book'}
                    </ThemedText>
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={
                <ThemedText type="small" themeColor="textSecondary" style={styles.sheetEmpty}>
                  There is nowhere else to send it — this is your only shared book.
                </ThemedText>
              }
            />

            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
              accessibilityRole="button">
              <ThemedText type="smallBold" themeColor="textSecondary">
                Cancel
              </ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The date a run of messages belongs to, centred above it. */
export function ChatDay({ day }: { day: string }) {
  const theme = useTheme();
  return (
    <View style={styles.dayRow}>
      <View style={[styles.dayChip, theme.glassWeak]}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.dayText}>
          {formatRelativeDay(day)}
        </ThemedText>
      </View>
    </View>
  );
}

/**
 * A shared entry, quoted.
 *
 * Shown inside a bubble when a message is about an entry, and above the
 * composer while one is attached — the same object in both places, so what you
 * attach is exactly what the other person sees.
 *
 * `onTint` is set when it sits on an accent-filled (own) bubble, where the
 * ordinary glass fill and secondary text both disappear.
 */
export function ChatEntryQuote({
  entry,
  youPaid,
  payerName,
  onTint,
  onPress,
  onRemove,
}: {
  /** Null when the entry has since been deleted by its author. */
  entry: SharedEntry | null;
  youPaid: boolean;
  payerName: string;
  onTint?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();

  const ink = onTint ? '#ffffff' : theme.text;
  const inkSoft = onTint ? 'rgba(255,255,255,0.78)' : theme.textSecondary;
  const surface: ViewStyle = onTint
    ? { backgroundColor: 'rgba(255,255,255,0.18)' }
    : theme.glassWeak;
  // On an accent bubble the money colours lose to the fill, so the rule
  // becomes the plain ink and direction is carried by the arrow and the words.
  const rule = onTint ? 'rgba(255,255,255,0.85)' : youPaid ? theme.money.in : theme.money.out;

  if (!entry) {
    return (
      <View style={[styles.quote, surface]}>
        <View style={[styles.quoteRule, { backgroundColor: inkSoft }]} />
        <ThemedText type="small" style={[styles.quoteGone, { color: inkSoft }]}>
          This entry was removed
        </ThemedText>
      </View>
    );
  }

  const body = (
    <>
      <View style={[styles.quoteRule, { backgroundColor: rule }]} />
      <View style={styles.quoteBody}>
        <View style={styles.quoteTop}>
          <MaterialIcons
            name={youPaid ? 'call-made' : 'call-received'}
            size={13}
            color={rule}
          />
          <ThemedText type="smallBold" style={[styles.quoteTitle, { color: ink }]} numberOfLines={1}>
            {youPaid ? 'You paid' : `${payerName} paid`} {formatMoney(entry.amount)}
          </ThemedText>
        </View>
        <ThemedText type="small" style={{ color: inkSoft }} numberOfLines={1}>
          {entry.note.trim() || formatRelativeDay(entry.day)}
        </ThemedText>
      </View>
      {onRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Remove the attached entry">
          <MaterialIcons name="close" size={18} color={inkSoft} />
        </Pressable>
      )}
    </>
  );

  if (!onPress) return <View style={[styles.quote, surface]}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open the entry this message is about"
      style={({ pressed }) => [styles.quote, surface, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

/**
 * A message, quoted.
 *
 * Shown inside a bubble that answers another one, and above the composer while
 * you are writing that answer — the same object in both places, so what you
 * see while typing is what lands in the thread.
 *
 * It reads the quoted message LIVE rather than keeping a copy of its words.
 * That is the whole reason `reply_to` stores an id: a message retracted after
 * it was answered empties every quote of it at once, instead of leaving the
 * retracted sentence preserved inside each reply — the one place "delete for
 * everyone" could otherwise be undone.
 */
export function ChatReplyQuote({
  message,
  authorLabel,
  onTint,
  onPress,
  onRemove,
}: {
  /**
   * Null when the quoted message isn't on this device: sent before you joined
   * the book, or a row this device's next pull hasn't reached yet.
   */
  message: SharedMessage | null;
  /** Who wrote the quoted message — 'You', or the other member's name. */
  authorLabel: string;
  onTint?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();

  const ink = onTint ? '#ffffff' : theme.text;
  const inkSoft = onTint ? 'rgba(255,255,255,0.78)' : theme.textSecondary;
  const surface: ViewStyle = onTint
    ? { backgroundColor: 'rgba(255,255,255,0.18)' }
    : theme.glassWeak;
  const rule = onTint ? 'rgba(255,255,255,0.85)' : theme.accentTint;

  // Missing and retracted both mean "there are no words to show", so neither
  // gets a name over it — a byline above 'Message unavailable' would be
  // claiming something about a message nobody can read.
  const gone = !message || !!message.deleted_at;
  const preview = !message
    ? 'Message unavailable'
    : message.deleted_at
      ? 'This message was deleted'
      : message.body.trim() || (message.entry_id ? 'Shared an entry' : 'Message');

  const body = (
    <>
      <View style={[styles.quoteRule, { backgroundColor: gone ? inkSoft : rule }]} />
      <View style={styles.quoteBody}>
        {!gone && (
          <ThemedText
            type="smallBold"
            style={[styles.quoteTitle, { color: onTint ? ink : rule }]}
            numberOfLines={1}>
            {authorLabel}
          </ThemedText>
        )}
        <ThemedText
          type="small"
          style={[{ color: inkSoft }, gone && styles.quoteItalic]}
          numberOfLines={2}>
          {preview}
        </ThemedText>
      </View>
      {onRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Cancel the reply">
          <MaterialIcons name="close" size={18} color={inkSoft} />
        </Pressable>
      )}
    </>
  );

  if (!onPress) return <View style={[styles.quote, surface]}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Go to the message this replies to"
      style={({ pressed }) => [styles.quote, surface, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

/**
 * One message.
 *
 * Mine fills with the accent and sits right; theirs is glass and sits left —
 * which is the whole of the "who said this" information, so no names are
 * repeated down the thread. A book has exactly two people in it.
 */
export function ChatBubble({
  body,
  time,
  mine,
  grouped,
  deleted,
  delivery,
  quote,
  replyQuote,
  footer,
  reactions,
  expiring,
  vanishing,
  edited,
  starred,
  highlight,
  selected,
  onSwipeEdit,
  onToggleSelect,
  onLongPress,
  onSwipeReply,
  onDoubleTap,
  onRetry,
}: {
  body: string;
  /** ISO timestamp; shown as a time inside the bubble's footer. */
  time: string;
  mine: boolean;
  /** The message above is from the same person, so this one sits closer. */
  grouped?: boolean;
  /** The sender took it back; the body is gone and a line stands in for it. */
  deleted?: boolean;
  /** Only shown on your own messages — theirs are, by definition, delivered. */
  delivery?: DeliveryState;
  quote?: React.ReactNode;
  /** The <ChatReplyQuote> for the message this one answers. */
  replyQuote?: React.ReactNode;
  /** The <ChatAmountAction> for money mentioned in the body. */
  footer?: React.ReactNode;
  /** The <ChatReactions> pills, hung under the bubble. */
  reactions?: React.ReactNode;
  /** This message deletes itself; the clock says so next to the time. */
  expiring?: boolean;
  /** Sent into a vanishing session — marked, so nobody is surprised by it. */
  vanishing?: boolean;
  /** The sender changed the words after sending them. */
  edited?: boolean;
  /** You have kept this one. Device-local, so only you ever see the mark. */
  starred?: boolean;
  /** The current search hit, lit so it can be found on a busy screen. */
  highlight?: boolean;
  onLongPress?: () => void;
  /** Dragging the bubble to the right far enough calls this. */
  onSwipeReply?: () => void;
  /**
   * Dragging your own bubble the OTHER way. Reply goes right for everything,
   * so the left half of the gesture is free for the one thing you can only do
   * to your own messages.
   */
  onSwipeEdit?: () => void;
  /** Selection mode: a tap toggles this message instead of reacting. */
  onToggleSelect?: () => void;
  /** Drawn as chosen while the thread is in selection mode. */
  selected?: boolean;
  /** Two quick taps — the shortcut every chat app has trained people into. */
  onDoubleTap?: () => void;
  /** A stuck message offers a retry; this is what the tap does. */
  onRetry?: () => void;
}) {
  const theme = useTheme();

  const ink = mine ? '#ffffff' : theme.text;
  const inkSoft = mine ? 'rgba(255,255,255,0.72)' : theme.textSecondary;

  /**
   * Two taps for a heart.
   *
   * Hand-rolled rather than a gesture, because a bubble has no single-tap
   * action: with nothing to wait and see about, the first tap costs nothing
   * and the second fires immediately.
   */
  const lastTap = useRef(0);
  const tap = () => {
    // In selection mode a tap means "this one", and nothing else.
    if (onToggleSelect) {
      onToggleSelect();
      return;
    }
    if (!onDoubleTap) return;
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      onDoubleTap();
      return;
    }
    lastTap.current = now;
  };

  /**
   * Pull the bubble aside to answer it.
   *
   * RIGHT ONLY, both for your messages and for theirs. WhatsApp's direction,
   * and the reason it works is that the one gesture means one thing wherever
   * it starts — a left-swipe reserved for "mine" would make the bubble you
   * most want to answer the one with the opposite rule.
   *
   * The drag lives in a shared value and the spring back runs on the UI
   * thread, so a flick stays smooth while the list is still settling.
   */
  const dragX = useSharedValue(0);

  // The screen hands down a fresh closure on every render, and rebuilding the
  // gesture for each of them would churn a handler per bubble per keystroke.
  // The latest one is kept in a ref and reached through a callback that never
  // changes, so the gesture below is built once.
  const reply = useRef(onSwipeReply);
  const edit = useRef(onSwipeEdit);
  useEffect(() => {
    reply.current = onSwipeReply;
    edit.current = onSwipeEdit;
  }, [onSwipeReply, onSwipeEdit]);
  const canReply = !!onSwipeReply;
  const canEdit = !!onSwipeEdit;
  const fireReply = useCallback(() => reply.current?.(), []);
  const fireEdit = useCallback(() => edit.current?.(), []);

  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canReply || canEdit)
        // Right for reply always; left only where there is an edit to reach.
        // A dead left half would still capture the gesture from the list.
        .activeOffsetX(canEdit ? [-SWIPE_ACTIVATE, SWIPE_ACTIVATE] : SWIPE_ACTIVATE)
        .failOffsetY([-SWIPE_FAIL_Y, SWIPE_FAIL_Y])
        .onUpdate((event) => {
          const low = canEdit ? -SWIPE_MAX : 0;
          const high = canReply ? SWIPE_MAX : 0;
          dragX.value = Math.min(Math.max(event.translationX, low), high);
        })
        .onEnd(() => {
          if (dragX.value >= SWIPE_TRIGGER) runOnJS(fireReply)();
          else if (dragX.value <= -SWIPE_TRIGGER) runOnJS(fireEdit)();
          dragX.value = withSpring(0, { damping: 20, stiffness: 260, mass: 0.5 });
        }),
    [canEdit, canReply, dragX, fireEdit, fireReply]
  );

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: dragX.value }] }));

  // The arrow fades and grows with the drag, so the gesture shows its own
  // progress rather than either firing or not with nothing in between.
  const hint = useAnimatedStyle(() => {
    const progress = Math.min(Math.max(dragX.value, 0) / SWIPE_TRIGGER, 1);
    return { opacity: progress, transform: [{ scale: 0.5 + progress * 0.5 }] };
  });

  const editHint = useAnimatedStyle(() => {
    const progress = Math.min(Math.max(-dragX.value, 0) / SWIPE_TRIGGER, 1);
    return { opacity: progress, transform: [{ scale: 0.5 + progress * 0.5 }] };
  });

  const row = (
    <Pressable
      onPress={tap}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.bubbleRow,
        mine ? styles.bubbleRowMine : styles.bubbleRowTheirs,
        grouped && styles.bubbleRowGrouped,
        pressed && onLongPress ? styles.pressed : undefined,
      ]}>
      {/* Bubble and reactions as a column, so the pills line up with the edge
          the message came from instead of sitting beside it. */}
      <View style={[styles.bubbleStack, mine ? styles.stackMine : styles.stackTheirs]}>
        <View
          style={[
            styles.bubble,
            mine
              ? [styles.bubbleMine, { backgroundColor: theme.accent }]
              : [styles.bubbleTheirs, theme.glass],
            highlight && { borderWidth: 2, borderColor: theme.accentTint },
            selected && { borderWidth: 2, borderColor: theme.accent },
          ]}>
          {!deleted && replyQuote}
          {!deleted && quote}
          {/* Text and time on ONE row, the way every chat app does it: a short
              message and its timestamp belong on the same line, and only a long
              one pushes the time down to sit at the bottom of the block. */}
          <View style={styles.bubbleContent}>
            {deleted ? (
              /* What stands where the message was. Italic and muted so it reads
                 as the thread describing itself rather than as something said. */
              <View style={styles.deletedRow}>
                <MaterialIcons name="block" size={14} color={inkSoft} />
                <ThemedText type="small" style={[styles.deletedText, { color: inkSoft }]}>
                  {mine ? 'You deleted this message' : 'This message was deleted'}
                </ThemedText>
              </View>
            ) : (
              !!body && (
                <ChatText body={body} onTint={mine} style={[styles.bubbleText, { color: ink }]} />
              )
            )}
            <View style={styles.bubbleFoot}>
              {starred && (
                <MaterialIcons
                  name="star"
                  size={12}
                  color={inkSoft}
                  accessibilityLabel="Starred"
                />
              )}
              {edited && (
                <ThemedText type="small" style={[styles.bubbleTime, { color: inkSoft }]}>
                  edited
                </ThemedText>
              )}
              {vanishing && (
                <MaterialIcons
                  name="visibility-off"
                  size={12}
                  color={inkSoft}
                  accessibilityLabel="Vanishes when you leave"
                />
              )}
              {expiring && (
                <MaterialIcons
                  name="timer"
                  size={12}
                  color={inkSoft}
                  accessibilityLabel="Disappears later"
                />
              )}
              <ThemedText type="small" style={[styles.bubbleTime, { color: inkSoft }]}>
                {formatTime(time)}
              </ThemedText>
              {mine && delivery && (
                <Pressable
                  onPress={delivery === 'stuck' ? onRetry : undefined}
                  disabled={delivery !== 'stuck'}
                  hitSlop={8}
                  accessibilityRole={delivery === 'stuck' ? 'button' : undefined}>
                  <MaterialIcons
                    // Queued, with the server, read — the same states the rest
                    // of the app shows as a cloud mark, at footnote size, plus
                    // the one the cloud has no room for: still queued long
                    // after it should have gone.
                    name={
                      delivery === 'pending'
                        ? 'schedule'
                        : delivery === 'stuck'
                          ? 'error-outline'
                          : delivery === 'sent'
                            ? 'check'
                            : 'done-all'
                    }
                    size={13}
                    color={delivery === 'read' ? READ_TICK : inkSoft}
                    accessibilityLabel={
                      delivery === 'pending'
                        ? 'Sending'
                        : delivery === 'stuck'
                          ? 'Not sent yet — tap to try again'
                          : delivery === 'sent'
                            ? 'Sent'
                            : delivery === 'delivered'
                              ? 'Delivered'
                              : 'Read'
                    }
                  />
                </Pressable>
              )}
            </View>
          </View>
          {!deleted && footer}
        </View>
        {reactions}
      </View>
    </Pressable>
  );

  if (!onSwipeReply && !onSwipeEdit) return row;

  return (
    <GestureDetector gesture={swipe}>
      {/* The arrow sits UNDER the row rather than beside it, so revealing it
          costs the bubble no width — a reply hint that squeezed the text
          would reflow every message in the thread as you dragged. */}
      <View style={styles.swipeRow}>
        <Reanimated.View style={[styles.swipeHint, hint]} pointerEvents="none">
          <MaterialIcons name="reply" size={16} color={theme.textSecondary} />
        </Reanimated.View>
        {canEdit && (
          <Reanimated.View
            style={[styles.swipeHint, styles.swipeHintRight, editHint]}
            pointerEvents="none">
            <MaterialIcons name="edit" size={15} color={theme.textSecondary} />
          </Reanimated.View>
        )}
        <Reanimated.View style={slide}>{row}</Reanimated.View>
      </View>
    </GestureDetector>
  );
}

/**
 * The bar you type in.
 *
 * Grows with the text to a few lines and then scrolls, so a long explanation
 * doesn't push the thread off the screen. The attach button is first because
 * "which entry is this about" is usually the thought that starts the message.
 */
export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onAttach,
  onAttachLongPress,
  attachment,
  reply,
  banner,
  editing,
  onCancelEdit,
  disabled,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onAttach: () => void;
  /**
   * Holding the receipt button instead of tapping it. The sheet is the right
   * answer when there is a choice to make; most of the time the entry being
   * discussed is simply the last one recorded.
   */
  onAttachLongPress?: () => void;
  /** The <ChatEntryQuote> for an attached entry, or null. */
  attachment?: React.ReactNode;
  /** The <ChatReplyQuote> for the message being answered, or null. */
  reply?: React.ReactNode;
  /** Anything that belongs above the bar — the disappearing-messages notice. */
  banner?: React.ReactNode;
  /**
   * The bar is correcting a message already sent rather than writing a new
   * one. The send button becomes a tick, because what it does is no longer
   * "send" — nothing new will appear in the thread.
   */
  editing?: boolean;
  onCancelEdit?: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const canSend = !disabled && (value.trim().length > 0 || !!attachment);
  const replying = !!reply;

  /**
   * Getting the bar to sit ON the keyboard rather than behind it.
   *
   * The bar lifts by how much of the screen the keyboard covers, taken from
   * the event's `height`. That is the one figure in a keyboard event that
   * survives edge-to-edge. `screenY` — the obvious choice, and the one
   * <KeyboardAvoidingView> works from — does not: Android reports it as the
   * bottom of the WINDOW'S VISIBLE FRAME, which under edge-to-edge no longer
   * shrinks when the keyboard opens, so it keeps naming the bottom of the
   * screen. Anything measured against it comes out as "the keyboard covers
   * nothing", which is how the bar ended up behind the keyboard.
   *
   * `height` is read off the IME window inset instead, so it is right whether
   * the window moved or not. On Android it is the part of the keyboard ABOVE
   * the navigation bar (the ime inset less the system-bar inset), so the bar's
   * own bottom inset goes back on to reach the screen edge; iOS already
   * reports the whole keyboard, home indicator included.
   */
  const [lift, setLift] = useState(0);

  /**
   * The emoji panel takes the KEYBOARD'S place, not the thread's.
   *
   * A sheet over the conversation would cover the message you are decorating,
   * which is the one thing you need to see while you choose. So the panel
   * opens into the gap the keyboard leaves behind, at the height the keyboard
   * last had — the bar then sits in exactly the same place either way, and
   * swapping between them doesn't move it by a pixel.
   *
   * The fallback height only matters before a keyboard has ever been seen on
   * this screen; one show event replaces it with the real thing.
   */
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(300);

  const input = useRef<TextInput>(null);

  useEffect(() => {
    // iOS reports `will` ahead of the animation, so the bar travels with the
    // keyboard; Android only has `did`, which lands a frame later.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      const covered =
        e.endCoordinates.height + (Platform.OS === 'android' ? insets.bottom : 0);
      setLift(covered > 0 ? covered : 0);
      // Anything tall enough to be a keyboard sets the panel's height. A
      // floating or hardware keyboard reports a sliver, which would leave the
      // panel too short to show a single row.
      if (covered > 160) setPanelHeight(covered);
      // The keyboard coming up at all means something took focus, so the
      // panel's turn is over — the two never share the space.
      setEmojiOpen(false);
    });

    const hide = Keyboard.addListener(hideEvent, () => setLift(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, [insets.bottom]);

  // Answering a message is a decision to write one, so the keyboard comes up
  // with the quote rather than making you tap the field to start.
  useEffect(() => {
    if (replying) input.current?.focus();
  }, [replying]);

  // Back closes the panel before it leaves the screen, the way it closes the
  // keyboard — otherwise the one gesture that dismisses everything else in
  // the app would skip straight past it.
  useEffect(() => {
    if (!emojiOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setEmojiOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [emojiOpen]);

  /**
   * Where the caret is, so an emoji lands where you are typing rather than
   * always at the end.
   *
   * Held in a ref because it changes on every keystroke and nothing renders
   * from it. `forced` is the one-shot opposite: after an insert the caret has
   * to be MOVED, which only a controlled `selection` can do — and it is
   * cleared the moment the field reports back, because leaving the field
   * permanently controlled is what makes an Android caret jump while typing.
   */
  const caret = useRef({ start: 0, end: 0 });
  const [forced, setForced] = useState<{ start: number; end: number } | null>(null);

  const edit = (next: string, at: number) => {
    caret.current = { start: at, end: at };
    setForced({ start: at, end: at });
    onChangeText(next);
  };

  const insertEmoji = (emoji: string) => {
    const start = Math.min(Math.max(caret.current.start, 0), value.length);
    const end = Math.min(Math.max(caret.current.end, start), value.length);
    edit(value.slice(0, start) + emoji + value.slice(end), start + emoji.length);
  };

  /**
   * The panel's own backspace.
   *
   * It has to exist: with the keyboard swapped out there is nothing else on
   * screen that can delete, and an emoji chosen by mistake would otherwise
   * cost you the keyboard and back again.
   */
  const backspace = () => {
    const start = Math.min(Math.max(caret.current.start, 0), value.length);
    const end = Math.min(Math.max(caret.current.end, start), value.length);
    if (start !== end) {
      edit(value.slice(0, start) + value.slice(end), start);
      return;
    }
    if (start === 0) return;
    const kept = dropLastGrapheme(value.slice(0, start));
    edit(kept + value.slice(start), kept.length);
  };

  const toggleEmoji = () => {
    if (emojiOpen) {
      // Back to the keyboard. Focusing is what raises it; closing the panel
      // first means the bar never drops to the bottom in between.
      setEmojiOpen(false);
      input.current?.focus();
      return;
    }
    setEmojiOpen(true);
    Keyboard.dismiss();
  };

  const covered = lift > 0 || emojiOpen;

  return (
    <View
      style={[
        styles.composerWrap,
        theme.glassOverlay,
        // The bar owns the home-indicator inset rather than sitting above it:
        // a chat bar that stops short of the bottom edge leaves a strip of the
        // mesh under it, which reads as the pane having come unstuck. The
        // keyboard draws over that area, so the inset goes while it is up.
        //
        // A margin rather than a transform, so the thread above gives up the
        // same height and the newest message stays in view above the bar.
        //
        // With the panel open the margin goes to zero and the PANEL holds that
        // height instead. They are the same number, which is what makes the
        // swap between keyboard and emoji invisible.
        { marginBottom: emojiOpen ? 0 : lift },
      ]}>
      {banner}
      <View style={[styles.composer, { paddingBottom: (covered ? 0 : insets.bottom) + Spacing.two }]}>
        {editing && (
          <View style={[styles.quote, theme.glassWeak]}>
            <View style={[styles.quoteRule, { backgroundColor: theme.accentTint }]} />
            <View style={styles.quoteBody}>
              <ThemedText
                type="smallBold"
                style={[styles.quoteTitle, { color: theme.accentTint }]}>
                Editing your message
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {value.trim() || 'Clear it and the message stays as it was.'}
              </ThemedText>
            </View>
            <Pressable
              onPress={onCancelEdit}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Stop editing">
              <MaterialIcons name="close" size={18} color={theme.textSecondary} />
            </Pressable>
          </View>
        )}
        {reply}
        {attachment}
        <View style={styles.composerRow}>
          <Pressable
            onPress={onAttach}
            onLongPress={onAttachLongPress}
            delayLongPress={350}
            disabled={disabled}
            hitSlop={6}
            style={({ pressed }) => [
              styles.attachBtn,
              theme.glassWeak,
              disabled && styles.dim,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Attach an entry to discuss">
            <MaterialIcons name="receipt-long" size={20} color={theme.accentTint} />
          </Pressable>

          {/* The emoji key lives INSIDE the field rather than as a fourth
              round button beside it: three buttons and a text box leave the
              box too narrow to read a sentence back on a small phone. */}
          {/* `glassInput` is typed for a TextInput only because that is the
              one place it had to go before this; it is a fill and a border,
              which a View takes just as happily. */}
          <View style={[styles.inputWrap, theme.glassInput as ViewStyle]}>
            <Pressable
              onPress={toggleEmoji}
              disabled={disabled}
              hitSlop={6}
              style={({ pressed }) => [
                styles.emojiBtn,
                disabled && styles.dim,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={emojiOpen ? 'Show the keyboard' : 'Choose an emoji'}>
              <MaterialIcons
                name={emojiOpen ? 'keyboard' : 'mood'}
                size={21}
                color={emojiOpen ? theme.accentTint : theme.textSecondary}
              />
            </Pressable>

            <TextInput
              ref={input}
              value={value}
              onChangeText={(text) => {
                if (forced) setForced(null);
                onChangeText(text);
              }}
              selection={forced ?? undefined}
              onSelectionChange={(event) => {
                caret.current = event.nativeEvent.selection;
                if (forced) setForced(null);
              }}
              // Tapping the field is a request for the keyboard, so the panel
              // gets out of the way before focus raises it.
              onPressIn={() => setEmojiOpen(false)}
              placeholder="Message"
              placeholderTextColor={theme.textSecondary}
              multiline
              editable={!disabled}
              style={[styles.input, { color: theme.text }]}
              accessibilityLabel="Message"
            />
          </View>

          <Pressable
            onPress={onSend}
            disabled={!canSend}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: canSend ? theme.accent : theme.backgroundSelected },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Save the change' : 'Send'}
            accessibilityState={{ disabled: !canSend }}>
            <MaterialIcons
              name={editing ? 'check' : 'arrow-upward'}
              size={20}
              color={canSend ? '#ffffff' : theme.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      {emojiOpen && (
        <EmojiPanel height={panelHeight} onPick={insertEmoji} onBackspace={backspace} />
      )}
    </View>
  );
}

/**
 * One row of the entry picker: a date, or an entry under it.
 *
 * Flattened into a single list rather than nested sections, because a
 * <FlatList> is what caps the sheet's height (see below) and sections would
 * mean a second scrolling container inside it.
 */
type PickRow =
  | { kind: 'day'; day: string; first: boolean }
  | { kind: 'entry'; entry: SharedEntry };

/**
 * Pick the entry a message is about.
 *
 * A sheet of the book's own entries rather than a free-text reference: the
 * point of mentioning one is that both people end up looking at the same row,
 * and a typed description can't guarantee that.
 *
 * Broken into days with the SAME line the book's statement uses — literally
 * <StatementDay>, not a copy of it. "Chai, PKR 60" and "Chai, PKR 60" are the
 * same two words twice over; which day each was is the only thing that tells
 * them apart, and a picker that leaves that out asks you to guess.
 */
export function EntryPickerSheet({
  visible,
  entries,
  me,
  payerName,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** The book's entries, newest first. */
  entries: SharedEntry[];
  me: string;
  payerName: string;
  onPick: (entry: SharedEntry) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const slide = useRef(new Animated.Value(24)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  // Entries arrive newest first and already sorted by day, so one pass is
  // enough: a header whenever the day changes under us.
  const rows = useMemo(() => {
    const out: PickRow[] = [];
    let current: string | null = null;
    for (const entry of entries) {
      if (entry.day !== current) {
        out.push({ kind: 'day', day: entry.day, first: out.length === 0 });
        current = entry.day;
      }
      out.push({ kind: 'entry', entry });
    }
    return out;
  }, [entries]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slide, { toValue: 0, friction: 9, tension: 80, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]).start();
    } else {
      slide.setValue(24);
      opacity.setValue(0);
    }
  }, [visible, slide, opacity]);

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
            <ThemedText type="smallBold" style={styles.sheetTitle}>
              Which entry?
            </ThemedText>

            <FlatList
              data={rows}
              keyExtractor={(row) =>
                row.kind === 'day' ? `day:${row.day}` : row.entry.id
              }
              // The CAP LIVES HERE, not on the sheet. A percentage maxHeight on
              // the sheet resolves against a parent with no height of its own,
              // which is how it ended up floating clear of the bottom of the
              // screen; a concrete cap on the one part that scrolls leaves the
              // sheet to size itself from its content, exactly like
              // <ActionSheet> — the sheet in this app that has always sat right.
              style={[styles.sheetList, { maxHeight: Math.round(height * 0.52) }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: row }) => {
                if (row.kind === 'day') {
                  // No running total here: a picker is a list of things to
                  // point at, and what the day came to is a fact about the
                  // statement rather than about the choice being made.
                  return <StatementDay day={row.day} net={0} first={row.first} showNet={false} />;
                }

                const entry = row.entry;
                const youPaid = entry.payer_id === me;
                const color = youPaid ? theme.money.in : theme.money.out;
                return (
                  <Pressable
                    onPress={() => {
                      onClose();
                      onPick(entry);
                    }}
                    style={({ pressed }) => [
                      styles.pickRow,
                      theme.glass,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button">
                    <MaterialIcons
                      name={youPaid ? 'call-made' : 'call-received'}
                      size={16}
                      color={color}
                    />
                    <View style={styles.pickBody}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {youPaid ? 'You paid' : `${payerName} paid`}
                      </ThemedText>
                      {!!entry.note.trim() && (
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {entry.note.trim()}
                        </ThemedText>
                      )}
                    </View>
                    <ThemedText type="smallBold" style={{ color }}>
                      {formatMoney(entry.amount)}
                    </ThemedText>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <ThemedText type="small" themeColor="textSecondary" style={styles.sheetEmpty}>
                  This book has no entries yet. Record who paid first, then come
                  back to discuss it.
                </ThemedText>
              }
            />

            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
              accessibilityRole="button">
              <ThemedText type="smallBold" themeColor="textSecondary">
                Cancel
              </ThemedText>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
  },
  dayRow: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
  dayChip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: 2,
  },
  dayText: {
    fontSize: 12,
  },
  // Tighter than a day chip's row: this one sits just above the bar rather
  // than between two runs of messages, where that much air reads as a gap.
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginBottom: Spacing.one,
  },
  infoValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomLeftRadius: Radius.card,
    borderBottomRightRadius: Radius.card,
  },
  selectCount: {
    flex: 1,
  },
  pinnedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomLeftRadius: Radius.card,
    borderBottomRightRadius: Radius.card,
  },
  pinnedBody: {
    flex: 1,
  },
  pinnedWho: {
    fontSize: 11,
  },
  balanceStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.full,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    paddingVertical: Spacing.one,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  balanceText: {
    flex: 1,
    fontSize: 12,
  },
  settleBtn: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: 5,
  },
  vanishBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderRadius: Radius.card,
    padding: Spacing.three,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  vanishBody: {
    flex: 1,
    gap: 2,
  },
  vanishActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  vanishBtn: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.four,
    paddingVertical: 7,
  },
  vanishBtnText: {
    color: '#ffffff',
  },
  noticeRow: {
    alignItems: 'center',
    paddingTop: Spacing.two,
    paddingBottom: 2,
  },
  noticeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: 3,
    maxWidth: '88%',
  },
  unreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  unreadRule: {
    flex: 1,
    height: 1,
    opacity: 0.5,
  },
  unreadText: {
    fontSize: 12,
  },
  typingRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.card,
    borderBottomLeftRadius: Radius.small,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
  },
  reactionRow: {
    flexDirection: 'row',
    gap: Spacing.one,
    marginTop: -6,
    paddingHorizontal: Spacing.one,
  },
  reactionRowMine: {
    justifyContent: 'flex-end',
  },
  reactionRowTheirs: {
    justifyContent: 'flex-start',
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: Radius.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  reactionEmoji: {
    fontSize: 13,
    lineHeight: 18,
  },
  reactionCount: {
    fontSize: 11,
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
    marginBottom: Spacing.two,
  },
  quickKey: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickEmoji: {
    fontSize: 24,
    lineHeight: 30,
  },
  amountAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.small,
    paddingHorizontal: Spacing.two,
    paddingVertical: 5,
  },
  amountActionText: {
    flexShrink: 1,
    fontSize: 12,
  },
  jumpWrap: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.two,
  },
  jumpBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomLeftRadius: Radius.card,
    borderBottomRightRadius: Radius.card,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 6,
    includeFontPadding: false,
  },
  searchNone: {
    fontStyle: 'italic',
  },
  // Holds the row and the reply arrow it slides off, stacked rather than side
  // by side — see <ChatBubble>.
  swipeRow: {
    position: 'relative',
  },
  swipeHint: {
    position: 'absolute',
    left: 0,
    top: Spacing.two,
    bottom: 0,
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeHintRight: {
    left: undefined,
    right: 0,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginTop: Spacing.two,
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubbleRowTheirs: {
    justifyContent: 'flex-start',
  },
  // A run from one person reads as one turn in the conversation, so the
  // messages inside it sit closer than the gap between turns.
  bubbleRowGrouped: {
    marginTop: 3,
  },
  // The column the bubble and its reactions share. The width cap lives here
  // rather than on the bubble so a long message and its pills agree on an edge.
  bubbleStack: {
    maxWidth: '84%',
  },
  stackMine: {
    alignItems: 'flex-end',
  },
  stackTheirs: {
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    gap: Spacing.one,
  },
  // One tight corner on the side the message came from — the detail that makes
  // a stack of rounded rectangles read as speech.
  bubbleMine: {
    borderBottomRightRadius: Radius.small,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
  },
  bubbleTheirs: {
    borderBottomLeftRadius: Radius.small,
  },
  bubbleContent: {
    flexDirection: 'row',
    // Bottom, not centre: against a message that wrapped to four lines the
    // time belongs beside the last one, not floating halfway up the bubble.
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  deletedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  deletedText: {
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
    flexShrink: 1,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
    // Shrink rather than push the time out of the bubble — long text wraps
    // inside itself and the time keeps its place at the bottom right.
    flexShrink: 1,
  },
  bubbleFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    // Sits the time on the text's last baseline rather than under its descenders.
    paddingBottom: 2,
  },
  bubbleTime: {
    fontSize: 11,
    lineHeight: 14,
  },
  quote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.small,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.one,
    overflow: 'hidden',
  },
  // The bar down the left edge: the one mark that says "this is quoted".
  quoteRule: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 999,
  },
  quoteBody: {
    flex: 1,
    paddingVertical: 1,
  },
  quoteTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  quoteTitle: {
    flexShrink: 1,
    fontSize: 13,
  },
  quoteGone: {
    flex: 1,
    paddingVertical: Spacing.one,
    fontSize: 13,
    fontStyle: 'italic',
  },
  quoteItalic: {
    fontStyle: 'italic',
  },
  // The pane: the bar and, below it, the emoji panel when it is open. The
  // glass lives here so the two read as one slab rather than as a bar with a
  // separate box under it.
  composerWrap: {
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    overflow: 'hidden',
  },
  composer: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The field and its emoji key, framed as one control.
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: Radius.large,
    paddingLeft: Spacing.half,
    paddingRight: Spacing.two,
    minHeight: 40,
  },
  emojiBtn: {
    width: 32,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing.one,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 40,
    // Android pads a multiline field by the font's own ascent and descent on
    // top of everything set here, which made the box taller than the 40dp
    // buttons beside it and pinned the first line to the top of it. Off, the
    // 20dp line plus 10dp either side is exactly the 40dp it asks for.
    includeFontPadding: false,
    textAlignVertical: 'center',
    // Four or five lines, then it scrolls — past that the thread would be gone.
    maxHeight: 112,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
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
  sheetTitle: {
    paddingHorizontal: Spacing.two,
  },
  sheetList: {
    flexGrow: 0,
  },
  sheetEmpty: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginBottom: Spacing.two,
    minHeight: 52,
  },
  pickBody: {
    flex: 1,
    gap: 1,
  },
  cancel: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    minHeight: 48,
  },
  pressed: {
    opacity: 0.82,
  },
  dim: {
    opacity: 0.4,
  },
});
