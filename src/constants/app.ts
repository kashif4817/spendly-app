/**
 * App-wide settings that aren't tied to color scheme.
 *
 * To change the currency, edit CURRENCY below. It's used everywhere money is
 * shown, so this one line controls the whole app.
 */

/** Currency label shown in front of every amount, e.g. "PKR " "$" or "€ ". */
export const CURRENCY = 'PKR ';

/** Accent colors for money direction, shared across screens. */
export const MoneyColors = {
  in: '#0A9A7E', // income / money in  (brand teal)
  out: '#e5484d', // expense / money out (red)
} as const;

/** Budget progress colors: comfortably under, near (80%+), and over the limit. */
export const BudgetColors = {
  ok: MoneyColors.in,
  warn: '#f59e0b',
  over: MoneyColors.out,
} as const;
