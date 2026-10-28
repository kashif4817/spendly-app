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
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import type { SharedEntry } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay, formatTime } from '@/lib/date';
import { formatMoney } from '@/lib/money';

/**
 * How far a message has got, and the tick that says so:
 *
 *   pending   — still in the outbox        ·  a clock
 *   sent      — the server has it          ·  one tick
 *   delivered — their phone has it         ·  two ticks
 *   read      — they have opened the thread ·  two blue ticks
 */
export type DeliveryState = 'pending' | 'sent' | 'delivered' | 'read';

/**
 * The read tick's blue.
 *
 * Fixed rather than taken from the theme, because it only ever sits on an
 * accent-filled bubble — which is a saturated colour in both themes, and the
 * light theme's azure would sink straight into it.
 */
const READ_TICK = '#7CC9FF';

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
  onLongPress,
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
  onLongPress?: () => void;
}) {
  const theme = useTheme();

  const ink = mine ? '#ffffff' : theme.text;
  const inkSoft = mine ? 'rgba(255,255,255,0.72)' : theme.textSecondary;

  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.bubbleRow,
        mine ? styles.bubbleRowMine : styles.bubbleRowTheirs,
        grouped && styles.bubbleRowGrouped,
        pressed && onLongPress ? styles.pressed : undefined,
      ]}>
      <View
        style={[
          styles.bubble,
          mine
            ? [styles.bubbleMine, { backgroundColor: theme.accent }]
            : [styles.bubbleTheirs, theme.glass],
        ]}>
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
              <ThemedText type="small" style={[styles.bubbleText, { color: ink }]}>
                {body}
              </ThemedText>
            )
          )}
          <View style={styles.bubbleFoot}>
            <ThemedText type="small" style={[styles.bubbleTime, { color: inkSoft }]}>
              {formatTime(time)}
            </ThemedText>
            {mine && delivery && (
              <MaterialIcons
                // Queued, with the server, read. The same three states the
                // rest of the app shows as a cloud mark — at footnote size.
                name={
                  delivery === 'pending'
                    ? 'schedule'
                    : delivery === 'sent'
                      ? 'check'
                      : 'done-all'
                }
                size={13}
                color={delivery === 'read' ? READ_TICK : inkSoft}
                accessibilityLabel={
                  delivery === 'pending'
                    ? 'Sending'
                    : delivery === 'sent'
                      ? 'Sent'
                      : delivery === 'delivered'
                        ? 'Delivered'
                        : 'Read'
                }
              />
            )}
          </View>
        </View>
      </View>
    </Pressable>
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
  attachment,
  disabled,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onAttach: () => void;
  /** The <ChatEntryQuote> for an attached entry, or null. */
  attachment?: React.ReactNode;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const canSend = !disabled && (value.trim().length > 0 || !!attachment);

  /**
   * Getting the bar to sit ON the keyboard rather than behind it or above it.
   *
   * The bar measures where it actually is and lifts by however much the
   * keyboard covers it. That is deliberately not the keyboard's height: under
   * edge-to-edge Android may resize the window beneath the keyboard, in which
   * case most of the work is already done and lifting by the full height
   * throws the bar into the middle of the screen — which is exactly what a
   * <KeyboardAvoidingView> with a header offset was doing here. An overlap is
   * the one quantity that is right whether the window moved or not.
   *
   * The lift feeds back into its own measurement, so each reading ADDS to the
   * last. A keyboard that changes height (emoji, a suggestion strip appearing)
   * then settles in one more step instead of fighting the previous value.
   */
  const bar = useRef<View>(null);
  const [lift, setLift] = useState(0);
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    // iOS reports `will` ahead of the animation, so the bar travels with the
    // keyboard; Android only has `did`, which lands a frame later.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      setKeyboardUp(true);
      const node = bar.current;
      if (!node) return;
      // `screenY` is the top of the keyboard in the same space measureInWindow
      // reports, so the difference is the overlap and nothing else.
      const keyboardTop = e.endCoordinates.screenY;
      node.measureInWindow((_x, y, _width, height) => {
        const overlap = y + height - keyboardTop;
        setLift((current) => Math.max(current + overlap, 0));
      });
    });

    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardUp(false);
      setLift(0);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View
      ref={bar}
      style={[
        styles.composer,
        theme.glassOverlay,
        // The bar owns the home-indicator inset rather than sitting above it:
        // a chat bar that stops short of the bottom edge leaves a strip of the
        // mesh under it, which reads as the pane having come unstuck. The
        // keyboard draws over that area, so the inset goes while it is up.
        {
          marginBottom: lift,
          paddingBottom: (keyboardUp ? 0 : insets.bottom) + Spacing.two,
        },
      ]}>
      {attachment}
      <View style={styles.composerRow}>
        <Pressable
          onPress={onAttach}
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

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Message"
          placeholderTextColor={theme.textSecondary}
          multiline
          editable={!disabled}
          style={[styles.input, theme.glassInput, { color: theme.text }]}
          accessibilityLabel="Message"
        />

        <Pressable
          onPress={onSend}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.sendBtn,
            { backgroundColor: canSend ? theme.accent : theme.backgroundSelected },
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}>
          <MaterialIcons
            name="arrow-upward"
            size={20}
            color={canSend ? '#ffffff' : theme.textSecondary}
          />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Pick the entry a message is about.
 *
 * A sheet of the book's own entries rather than a free-text reference: the
 * point of mentioning one is that both people end up looking at the same row,
 * and a typed description can't guarantee that.
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
              data={entries}
              keyExtractor={(entry) => entry.id}
              // The CAP LIVES HERE, not on the sheet. A percentage maxHeight on
              // the sheet resolves against a parent with no height of its own,
              // which is how it ended up floating clear of the bottom of the
              // screen; a concrete cap on the one part that scrolls leaves the
              // sheet to size itself from its content, exactly like
              // <ActionSheet> — the sheet in this app that has always sat right.
              style={[styles.sheetList, { maxHeight: Math.round(height * 0.52) }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const youPaid = item.payer_id === me;
                const color = youPaid ? theme.money.in : theme.money.out;
                return (
                  <Pressable
                    onPress={() => {
                      onClose();
                      onPick(item);
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
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {item.note.trim() || formatRelativeDay(item.day)}
                      </ThemedText>
                    </View>
                    <ThemedText type="smallBold" style={{ color }}>
                      {formatMoney(item.amount)}
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
  bubble: {
    maxWidth: '84%',
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
  composer: {
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
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
  input: {
    flex: 1,
    borderRadius: Radius.large,
    paddingHorizontal: Spacing.three,
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
