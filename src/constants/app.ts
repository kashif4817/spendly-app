/**
 * App-wide settings that aren't tied to color scheme.
 *
 * To change the currency, edit CURRENCY below. It's used everywhere money is
 * shown, so this one line controls the whole app.
 */

/** Currency label shown in front of every amount, e.g. "PKR " "$" or "€ ". */
export const CURRENCY = 'PKR ';

/**
 * Accent colors for money direction, as FILLS and bright marks.
 *
 * Azure and rose, not green and red. Partly because the Aurora palette has no
 * green in it, but mostly because green/red is the one pairing a red-green
 * colourblind reader cannot separate — and on a ledger, direction is the whole
 * message. Azure and rose differ in hue AND in lightness, so they stay
 * distinct however the eye reads colour.
 */
export const MoneyColors = {
  in: '#2E90FA', // money in / toward you (azure)
  out: '#F23D6D', // money out / away from you (rose)
} as const;

/**
 * The same two directions as LABEL text on glass.
 *
 * The fills above are tuned to read as marks against a mesh; as small bold
 * text they land near 3.5:1, under the 4.5:1 a label needs. These are the same
 * hues taken darker (light theme) or lighter (dark theme) so a button or a
 * caption built from them stays readable. Large amounts keep `MoneyColors`.
 */
export const MoneyTextColors = {
  light: { in: '#0B6FB8', out: '#C0325E' },
  dark: { in: '#7CC9FF', out: '#FF8FAB' },
} as const;

/**
 * The same two directions as a FILLED button carrying a white label.
 *
 * These are the bright marks, not a deepened pair: the darker versions read
 * as muddy next to the rest of the palette, which is a worse outcome than the
 * contrast they bought. White on them lands near 3.2:1 (blue) and 3.7:1
 * (rose) — under the 4.5:1 WCAG asks for a 15px bold label, though white on a
 * saturated fill stays legible in practice. The labels are also kept short so
 * nothing important rests on reading them in bright sun.
 */
export const MoneyButtonColors = {
  in: MoneyColors.in,
  out: MoneyColors.out,
} as const;

/** Budget progress colors: comfortably under, near (80%+), and over the limit. */
export const BudgetColors = {
  ok: MoneyColors.in,
  warn: '#F59E0B',
  over: MoneyColors.out,
} as const;
