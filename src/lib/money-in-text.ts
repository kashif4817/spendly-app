/**
 * Find the amount someone just mentioned in a chat message.
 *
 * WHY THIS EXISTS: "I paid 4,500 for the gas" is how people actually report
 * an expense, and in every other chat app that sentence is where the record
 * ends — somebody has to read it later and retype the number into something
 * else. Here the thread sits next to the book it is about, so a message with
 * money in it can offer to become an entry in one tap, with the amount and
 * the sentence already filled in.
 *
 * It is deliberately a SUGGESTION and never an action: nothing is recorded
 * until the entry screen is confirmed. That is what lets the matching be
 * generous — a chip nobody wanted costs a glance, while a missed amount costs
 * the whole point of the feature.
 */

/** Amounts below this need a currency word to count, so "2 tickets" doesn't. */
const BARE_FLOOR = 100;

/** Longer than this and it is a phone number, an account number or an order id. */
const MAX_BARE_DIGITS = 6;

/** Numbers, with thousands separators, decimals and a 'k' shorthand. */
const TOKEN = /\d[\d,]*(?:\.\d+)?\s*[kK]?/g;

/** 'Rs', 'Rs.', 'PKR', '₨', 'rupees' — before the number. */
const MARKER_BEFORE = /(?:rs\.?|pkr|₨|rupees?|rupay|rupaye)\s*$/i;

/** The same, after it, plus the '/-' people write at the end of a figure. */
const MARKER_AFTER = /^\s*(?:rs\.?|pkr|₨|rupees?|\/-)/i;

export type AmountInText = {
  /** The number itself, in currency units. */
  amount: number;
  /** Exactly what was written, for the chip to echo back. */
  matched: string;
};

/**
 * The amount a message is most likely about, or null.
 *
 * The LARGEST plausible figure wins rather than the first. "4,500 for 2
 * tickets" and "2 nights at 3000" both name a count and a price, and the
 * price is always the larger of the two.
 */
export function findAmountInText(body: string): AmountInText | null {
  const text = body ?? '';
  if (!text) return null;

  let best: AmountInText | null = null;

  for (const match of text.matchAll(TOKEN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;

    const before = text.slice(Math.max(0, start - 10), start);
    // Two windows: punctuation only matters when it touches the number, but a
    // currency WORD after it ("50 rupees") needs room to be seen.
    const touching = text.slice(end, end + 2);
    const after = text.slice(end, end + 10);

    // A time, a date, a fraction or a percentage. The character touching the
    // number is enough to tell: 3:30, 12/5, 50%. The exception is "850/-",
    // where the slash is part of how the amount itself is written.
    if (/[:/]$/.test(before)) continue;
    if (/^[:%]/.test(touching) || /^\/(?!-)/.test(touching)) continue;
    // "#4" is a reference, not a price.
    if (/#\s*$/.test(before)) continue;

    const marked = MARKER_BEFORE.test(before) || MARKER_AFTER.test(after);
    const digits = raw.replace(/[^\d]/g, '');
    const scaled = /[kK]\s*$/.test(raw);

    // A long unbroken run of digits is an identifier of some kind. With a
    // currency word in front of it, it is a (very large) amount.
    if (!marked && !raw.includes(',') && digits.length > MAX_BARE_DIGITS) continue;

    const value = Number.parseFloat(raw.replace(/,/g, '').replace(/\s*[kK]$/, ''));
    if (!Number.isFinite(value) || value <= 0) continue;

    const amount = scaled ? value * 1000 : value;
    if (!marked && !scaled && amount < BARE_FLOOR) continue;
    // Beyond this it is not money anyone is splitting; it is a typo or an id.
    if (amount > 1e9) continue;

    if (!best || amount > best.amount) best = { amount, matched: raw.trim() };
  }

  return best;
}
