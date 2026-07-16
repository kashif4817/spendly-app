import { CURRENCY } from '@/constants/app';

/**
 * Format a number as a currency string. Whole amounts drop the decimals
 * (e.g. 1250 -> "Rs 1,250"), paisa are shown only when present
 * (e.g. 1250.5 -> "Rs 1,250.50").
 */
export function formatMoney(amount: number): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const abs = Math.abs(rounded);
  const hasFraction = Math.round(abs * 100) % 100 !== 0;
  const withGroups = abs.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${rounded < 0 ? '-' : ''}${CURRENCY}${withGroups}`;
}

/** Format with an explicit +/- sign, e.g. "+$10.00" / "-$4.50". */
export function formatSigned(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}${formatMoney(Math.abs(amount))}`;
}

/**
 * Parse user keypad/text input into a number of currency units.
 * Strips anything that isn't a digit or a dot; returns 0 for empty/invalid.
 */
export function parseAmount(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}
