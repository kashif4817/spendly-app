/**
 * The calculator, where the amount is.
 *
 * WHY: a bill gets divided before it gets recorded — three ways for dinner,
 * times four for the fares, minus the 200 somebody already put in. Until now
 * that meant leaving the app, doing the sum somewhere else and coming back
 * with a number, which is both annoying and the easiest possible way to lose
 * a digit.
 *
 * THE MATHS WAS ALREADY HERE. `parseAmount` has always evaluated "120+80" and
 * "45*3" — `looksLikeExpression` sat beside it, written and never called. The
 * only thing missing was a way to TYPE an operator: the amount field uses a
 * decimal pad, and a decimal pad has no + − × ÷ on it. So this is a keypad
 * that does, rather than a second implementation of arithmetic.
 *
 * Nothing is computed here. Every keystroke edits a string, and that string
 * goes through the same `parseAmount` the form would have used anyway, so a
 * sum worked out on this pad and the same sum typed by hand cannot disagree.
 *
 * NO "USE" BUTTON. Every key writes straight through to the field behind the
 * sheet, so the amount is already correct before the pad is dismissed — which
 * means there is no step left for a button to perform, and no state that
 * could be lost by closing without pressing one.
 *
 * THE ONE PLACE THE GLASS IS DROPPED. Everywhere else a translucent pane over
 * the mesh reads as a lit surface; over a FORM it reads as a smudge, because
 * the labels and buttons behind keep their edges and sit directly under the
 * digits. A keypad is the one surface that is pure function — so its pane is
 * opaque and its keys are solid tiles with their own edge. Nothing shows
 * through the thing a thumb is aiming at.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { CURRENCY } from '@/constants/app';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoney, parseAmount } from '@/lib/money';

/**
 * The pad's own palette.
 *
 * Not from `Glass`: those sets are translucent by design, and a key drawn in
 * them on top of an opaque sheet has almost no edge left — which is exactly
 * what made the old pad read as a field of ghosts. These are solid fills with
 * a stated pressed colour, so every key has a visible boundary and visible
 * feedback in both themes.
 */
const Pad = {
  light: {
    sheet: '#F5F4FE',
    edge: 'rgba(255,255,255,0.95)',
    rule: 'rgba(23,18,67,0.10)',
    key: '#FFFFFF',
    keyEdge: 'rgba(23,18,67,0.07)',
    keyDown: '#E6E3F8',
  },
  dark: {
    sheet: '#14112C',
    edge: 'rgba(255,255,255,0.16)',
    rule: 'rgba(255,255,255,0.12)',
    key: 'rgba(255,255,255,0.07)',
    keyEdge: 'rgba(255,255,255,0.10)',
    keyDown: 'rgba(255,255,255,0.20)',
  },
} as const;

/** `color` arrives as a 6-digit hex, so a tint of it is a slice of rgba. */
const tint = (hex: string, alpha: number) => {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/** What a key does when pressed. `wide` spans two columns. */
type Key = { wide?: boolean } & (
  | { kind: 'text'; label: string; append: string }
  | { kind: 'op'; label: string; append: string }
  | { kind: 'clear' }
  | { kind: 'back' }
  | { kind: 'equals' }
);

/**
 * The pad, row by row — the layout every calculator shares.
 *
 *     C C  ⌫  ÷
 *     7 8  9  ×
 *     4 5  6  −
 *     1 2  3  +
 *     0 00 .  =
 *
 * The whole right-hand column is operators, running ÷ × − + down it with the
 * equals at its foot, and the digits sit in the phone grid above the zero.
 * That ordering is the part worth being strict about: it is the one thing a
 * person's thumb already knows before they have looked at the pad, and an
 * earlier version that scattered ÷ and × along the top row and put equals
 * where the plus belongs made every key a thing to read rather than a place.
 *
 * Nineteen keys in twenty cells, so exactly one may be wide — C takes it,
 * since the spare cell is in its row and a hole would look like a bug.
 *
 * No brackets and no percent: `parseAmount` evaluates left to right with ×
 * and ÷ taking precedence, and a key it could not honour would be a lie.
 */
const KEYS: Key[][] = [
  [
    { kind: 'clear', wide: true },
    { kind: 'back' },
    { kind: 'op', label: '÷', append: '/' },
  ],
  [
    { kind: 'text', label: '7', append: '7' },
    { kind: 'text', label: '8', append: '8' },
    { kind: 'text', label: '9', append: '9' },
    { kind: 'op', label: '×', append: '*' },
  ],
  [
    { kind: 'text', label: '4', append: '4' },
    { kind: 'text', label: '5', append: '5' },
    { kind: 'text', label: '6', append: '6' },
    { kind: 'op', label: '−', append: '-' },
  ],
  [
    { kind: 'text', label: '1', append: '1' },
    { kind: 'text', label: '2', append: '2' },
    { kind: 'text', label: '3', append: '3' },
    { kind: 'op', label: '+', append: '+' },
  ],
  [
    { kind: 'text', label: '0', append: '0' },
    { kind: 'text', label: '00', append: '00' },
    { kind: 'text', label: '.', append: '.' },
    { kind: 'equals' },
  ],
];

/** Long enough for any bill, short enough that the total never shrinks to nothing. */
const MAX_LENGTH = 18;

/** The space between two keys. See the `pad` style for how it is applied. */
const GUTTER = Spacing.two;

/** True once the string is a finished sum rather than one waiting for a number. */
const isComplete = (text: string) => /[\d.]$/.test(text.trim());

/** The number currently being typed: everything after the last operator. */
const operand = (text: string) => /[\d.]*$/.exec(text)?.[0] ?? '';

/** The tape as a person writes it, rather than as `parseAmount` wants it. */
const pretty = (text: string) =>
  text.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\+/g, ' + ').replace(/-/g, ' − ').trim();

/**
 * How much room a string needs, in ems of its own size.
 *
 * Android has no `adjustsFontSizeToFit`, so the size has to be CHOSEN before
 * the layout rather than discovered by it. The old guess counted CHARACTERS,
 * which is why "467,995" was sized as a seven-character number and then
 * ellipsised to "467,9…" by a box that had never been that wide: a comma is
 * a third of a digit, and a currency code is letters, which are wider than
 * one. Both are counted here rather than averaged away.
 *
 * The ratios are those of the bold face the figure is set in (Roboto ≈ 0.57em
 * per digit, SF ≈ 0.60em), rounded up — so the estimate errs towards a size
 * that definitely fits over one that only nearly does.
 */
const ems = (text: string) =>
  [...text].reduce((sum, ch) => {
    if (ch === ',' || ch === '.') return sum + 0.32;
    if (ch === '-' || ch === ' ') return sum + 0.34;
    if (/[a-z]/i.test(ch)) return sum + 0.7;
    return sum + 0.62;
  }, 0);

/** Big enough to be the point of the screen, small enough that a long bill still lands. */
const MAX_RESULT = 52;
const MIN_RESULT = 20;

/**
 * The currency code holds ITS size while the figure moves.
 *
 * It is a label, not a quantity; resizing it on every keystroke would make
 * the one still thing on the screen twitch along with the one that changes.
 */
const CURRENCY_SIZE = 19;

/** The space between code and figure, in ems of the figure — it is literally a space character. */
const CURRENCY_GAP = 0.34;

/** Something plausible to size against for the one frame before the real width is known. */
const ASSUMED_WIDTH = 230;

/**
 * The largest size at which code, gap and figure all still fit on one line.
 *
 * The width is MEASURED rather than assumed: the tick takes a fixed bite out
 * of the display, and what is left over depends on the phone.
 */
const fitResult = (shown: string, width: number) => {
  const needed = ems(shown) + CURRENCY_GAP;
  const room = (width || ASSUMED_WIDTH) - ems(CURRENCY.trim()) * CURRENCY_SIZE;
  return Math.max(MIN_RESULT, Math.min(MAX_RESULT, Math.floor(room / needed)));
};

export function CalculatorSheet({
  visible,
  initial,
  color,
  onChange,
  onClose,
}: {
  visible: boolean;
  /** Whatever is already in the amount field, so the pad opens on it. */
  initial: string;
  /** The form's direction colour, so the result reads in / out like the field. */
  color: string;
  /** Called on every key, with the raw text — the field evaluates it itself. */
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const pad = Pad[theme.scheme];
  const [text, setText] = useState('');

  /**
   * The room the figure actually has.
   *
   * A number that must not wrap and must not be cut can only be sized against
   * a width somebody has measured — the tick takes a fixed bite out of the
   * display, and the rest is however wide the phone is.
   */
  const [tapeWidth, setTapeWidth] = useState(0);

  /**
   * Keys sized off the screen rather than fixed at 64.
   *
   * Five rows plus a display plus a gesture bar is most of a short phone, and
   * a pad that runs off the bottom loses its zero. Clamped so it never gets
   * fiddly on a small screen or cartoonish on a tall one.
   */
  const keyHeight = Math.max(46, Math.min(62, Math.round(height * 0.072)));

  /**
   * The display gets a fifth of the screen, not just the room its text needs.
   *
   * This is the only part of the sheet anybody actually READS — the keys are
   * aimed at, the number is read — and sizing it to its own line heights left
   * the total pinned between a grabber and a rule with nothing around it. A
   * calculator's screen is mostly empty space on purpose: the figure needs
   * somewhere to sit, and the running sum above it needs somewhere to go.
   */
  const displayHeight = Math.max(132, Math.min(200, Math.round(height * 0.2)));

  /**
   * The field's value at the moment the pad opens.
   *
   * Through a ref, because every key now writes back to that same field — so
   * depending on it directly would re-seed the pad from its own output on
   * every tap.
   */
  const seed = useRef(initial);
  seed.current = initial;

  useEffect(() => {
    if (visible) setText(seed.current.trim());
  }, [visible]);

  /**
   * What the total says.
   *
   * `parseAmount` is the same function the field behind is running on this
   * very string, so the display cannot disagree with the amount already
   * recorded — including mid-sum, where "580+" is still worth 580. The old
   * pad dropped to 0 the moment an operator was typed, which made the one
   * number anybody was watching flash to zero between every two digits.
   */
  const value = parseAmount(text);
  const shown = text ? formatMoney(value).replace(CURRENCY, '') : '0';
  const resultSize = fitResult(shown, tapeWidth);

  /**
   * Whether there is an answer for equals to collapse the tape to.
   *
   * Read by the key as well as by the handler, so the loudest button on the
   * pad is never lit for a press that would do nothing — which is the price
   * of making it the loudest button.
   */
  const resolvable = isComplete(text) && Number.isFinite(value) && value > 0;

  /** One place to change the tape, so the field behind can never fall behind it. */
  const write = (next: string) => {
    setText(next);
    onChange(next);
  };

  const press = (key: Key) => {
    if (key.kind === 'clear') {
      write('');
      return;
    }
    if (key.kind === 'back') {
      write(text.slice(0, -1));
      return;
    }
    if (key.kind === 'equals') {
      // Collapse to the answer so the next operator carries on from it. A
      // division by zero has no answer, so it leaves the sum alone rather
      // than quietly writing a 0 nobody asked for.
      if (!resolvable) return;
      write(String(Math.round(value * 100) / 100));
      return;
    }

    const trimmed = text.trim();

    if (key.kind === 'op') {
      // Nothing to operate on yet, except a leading minus.
      if (!trimmed) {
        if (key.append === '-') write('-');
        return;
      }
      // Typing a second operator REPLACES the first, which is what anyone who
      // has ever mistyped "+×" expects to happen.
      if (/[+\-*/]$/.test(trimmed)) {
        write(trimmed.slice(0, -1) + key.append);
        return;
      }
      write(trimmed + key.append);
      return;
    }

    if (trimmed.length >= MAX_LENGTH) return;

    const current = operand(trimmed);

    if (key.append === '.') {
      // One point per number, and a point with nothing before it gets its 0.
      if (current.includes('.')) return;
      write(trimmed + (current ? '.' : '0.'));
      return;
    }

    /**
     * A number cannot start 000.
     *
     * Tapping zero first and then the amount used to leave "000737" sitting
     * in the field — right answer, wrong string, and the string is what gets
     * read. A lone leading zero is swallowed by the digit that follows it.
     */
    if (current === '0') {
      if (key.append === '0' || key.append === '00') return;
      write(trimmed.slice(0, -1) + key.append);
      return;
    }
    if (!current && (key.append === '0' || key.append === '00')) {
      write(trimmed + '0');
      return;
    }

    write(trimmed + key.append);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close the calculator">
        {/* Swallows taps so pressing the pad itself doesn't close it. */}
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            {
              backgroundColor: pad.sheet,
              borderTopColor: pad.edge,
              paddingBottom: insets.bottom + Spacing.three,
            },
          ]}>
          <View style={[styles.grabber, { backgroundColor: pad.rule }]} />

          {/* The tape: what you have typed, and what it comes to. The tick is
              the way out — the amount behind is already this number, so it
              closes rather than confirming anything. */}
          <View style={[styles.tape, { minHeight: displayHeight }]}>
            <View
              style={styles.tapeText}
              onLayout={(event) => setTapeWidth(event.nativeEvent.layout.width)}>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                numberOfLines={1}
                // The end of a running sum is the part being typed, so a long
                // one loses its head rather than the digits just entered.
                ellipsizeMode="head"
                style={styles.expression}>
                {pretty(text) || ' '}
              </ThemedText>
              {/* Code and figure are ONE line of text rather than two views in
                  a row: nested text shares a baseline by construction, where a
                  baseline-aligned row has to be taken on trust from two
                  platforms that have not always agreed about it. */}
              <ThemedText
                numberOfLines={1}
                style={[
                  styles.result,
                  {
                    color: text ? theme.text : theme.textSecondary,
                    fontSize: resultSize,
                    // THE LINE BOX, which is what was cutting the figure in
                    // half. `ThemedText` defaults to a 24px line, the size
                    // below it overrode the font and not the line, and a 52px
                    // glyph in a 24px box is drawn with its bottom sliced off.
                    // Every size states its own line.
                    lineHeight: Math.round(resultSize * 1.12),
                  },
                ]}>
                <Text style={[styles.currency, { color }]}>{CURRENCY.trim()}</Text>{' '}
                {shown}
              </ThemedText>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.done,
                { backgroundColor: color },
                pressed && styles.donePressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Done">
              <MaterialIcons name="check" size={26} color="#ffffff" />
            </Pressable>
          </View>

          <View style={[styles.rule, { backgroundColor: pad.rule }]} />

          <View style={styles.pad}>
            {KEYS.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.padRow}>
                {row.map((key) => (
                  <CalcKey
                    key={key.kind === 'text' || key.kind === 'op' ? key.label : key.kind}
                    item={key}
                    color={color}
                    height={keyHeight}
                    disabled={key.kind === 'equals' && !resolvable}
                    onPress={() => press(key)}
                  />
                ))}
              </View>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CalcKey({
  item,
  color,
  height,
  disabled,
  onPress,
}: {
  item: Key;
  color: string;
  height: number;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const pad = Pad[theme.scheme];

  const label =
    item.kind === 'clear'
      ? 'C'
      : item.kind === 'equals'
        ? '='
        : item.kind === 'back'
          ? ''
          : item.label;

  /**
   * THREE kinds of key, told apart by their TILE and not only by their text.
   *
   * Equals is SOLID — the form's colour filled in, with white on it. It is
   * the only key on the pad that resolves anything rather than adding to the
   * tape, and until it was filled it sat in the same wash as the four
   * operators, which made the one key you finish on the hardest to find.
   *
   * Operators and the backspace are that colour on a wash of itself; digits
   * are ink on a plain tile. Colouring the glyph alone — which is what the
   * pad did first — left the right-hand column looking like stray marks
   * rather than a group, and the backspace like a dropped blob.
   */
  const isEquals = item.kind === 'equals';
  const isAction = item.kind === 'op' || item.kind === 'back';
  // A tint has to work harder over a dark pane than over a near-white one.
  const strength = theme.scheme === 'light' ? 1 : 1.6;

  const face = isEquals
    ? { backgroundColor: color, borderColor: color }
    : isAction
      ? { backgroundColor: tint(color, 0.09 * strength), borderColor: tint(color, 0.2 * strength) }
      : { backgroundColor: pad.key, borderColor: pad.keyEdge };

  const ink = isEquals
    ? '#FFFFFF'
    : isAction
      ? color
      : item.kind === 'clear'
        ? theme.textSecondary
        : theme.text;

  return (
    // The cell carries the gutter as padding rather than the row carrying it
    // as a gap, which is the only way a two-column key lands on the same
    // edges as the two keys above it — a `flex: 2` key in a gapped row comes
    // up half a gutter short, and the whole grid goes out by a few pixels.
    <View style={[styles.cell, item.wide && styles.cellWide]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.key,
          face,
          { height },
          disabled && styles.keyDisabled,
          pressed &&
            (isEquals
              ? styles.keyPressedSolid
              : { backgroundColor: isAction ? tint(color, 0.22 * strength) : pad.keyDown }),
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        accessibilityLabel={
          item.kind === 'back'
            ? 'Delete the last character'
            : item.kind === 'clear'
              ? 'Clear'
              : item.kind === 'equals'
                ? 'Equals'
                : item.label
        }>
        {item.kind === 'back' ? (
          <MaterialIcons name="backspace" size={height < 52 ? 19 : 22} color={ink} />
        ) : (
          // "00" is two glyphs in one key's worth of room, so it drops a size.
          <ThemedText
            style={[
              styles.keyText,
              { color: ink, fontSize: label === '00' ? 20 : 23 },
              // The one key that has to be seen before it is read.
              isEquals && styles.keyTextSolid,
            ]}>
            {label}
          </ThemedText>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    borderTopWidth: 1,
    borderTopLeftRadius: Radius.large,
    borderTopRightRadius: Radius.large,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    boxShadow: [{ offsetX: 0, offsetY: -8, blurRadius: 40, color: 'rgba(9,7,26,0.30)' }],
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.two,
  },
  tape: {
    flexDirection: 'row',
    // The figure sits at the BOTTOM of the screen area with the empty room
    // above it, which is where a calculator has always put it — and it keeps
    // the number next to the thumb rather than up by the grabber.
    alignItems: 'flex-end',
    gap: Spacing.three,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  tapeText: {
    flex: 1,
  },
  expression: {
    textAlign: 'right',
    fontSize: 17,
    lineHeight: 24,
    height: 24,
    includeFontPadding: false,
  },
  currency: {
    fontSize: CURRENCY_SIZE,
    fontWeight: '700',
  },
  result: {
    textAlign: 'right',
    fontWeight: '700',
    marginTop: Spacing.one,
    /**
     * Android adds the font's own ascent and descent ON TOP of the line
     * height. At 52px that is a band of nothing above and below the digits,
     * which pushed the figure down its box and ate the gap under the running
     * sum. The line height above is the whole of the room this needs.
     */
    includeFontPadding: false,
  },
  done: {
    width: 58,
    height: 58,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    // Lifted by the descender space under the figure, so the tick reads as
    // level with the digits rather than with the bottom of their line box.
    marginBottom: Spacing.one,
  },
  donePressed: {
    opacity: 0.8,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginBottom: Spacing.three,
  },
  /**
   * The grid's gutters live on the CELLS, as half a gutter each side, with
   * the pad pulled out by that half again so the outer keys still sit on the
   * sheet's own margin. Laid out this way a cell is an exact quarter of the
   * row whatever is in it, so a two-column key is exactly two cells plus the
   * gutter between them — which a `flex: 2` key in a `gap`-ed row is not.
   */
  pad: {
    gap: GUTTER,
    marginHorizontal: -GUTTER / 2,
  },
  padRow: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    paddingHorizontal: GUTTER / 2,
  },
  cellWide: {
    flex: 2,
  },
  key: {
    borderWidth: 1,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDisabled: {
    opacity: 0.38,
  },
  // A filled key has no wash left to deepen, so the press shows as a dip.
  keyPressedSolid: {
    opacity: 0.82,
  },
  keyText: {
    fontWeight: '600',
  },
  keyTextSolid: {
    fontWeight: '700',
  },
});
