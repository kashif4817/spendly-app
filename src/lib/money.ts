import { CURRENCY } from '@/constants/app';

/**
 * Format a number as a currency string. Whole amounts drop the decimals
 * (e.g. 1250 -> "PKR 1,250"), paisa are shown only when present
 * (e.g. 1250.5 -> "PKR 1,250.50").
 */
export function formatMoney(amount: number): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const abs = Math.abs(rounded);
  const paisa = Math.round(abs * 100) % 100;

  /**
   * Grouped by hand, NOT through `toLocaleString('en-US', …)`.
   *
   * Hermes ships without full ICU, so on a device whose own locale groups with
   * a point the requested 'en-US' is quietly ignored and 9676 comes back as
   * "9.676" — a number that reads as nine-point-six-seven-six in an app whose
   * entire subject is amounts of money. The separator here is a decision, so
   * it is stated rather than asked for.
   */
  const whole = String(Math.floor(abs)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = paisa ? `.${String(paisa).padStart(2, '0')}` : '';

  return `${rounded < 0 ? '-' : ''}${CURRENCY}${whole}${fraction}`;
}

/** Format with an explicit +/- sign, e.g. "+$10.00" / "-$4.50". */
export function formatSigned(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}${formatMoney(Math.abs(amount))}`;
}

/** True if the text looks like a calculation (has an operator to evaluate). */
export function looksLikeExpression(text: string): boolean {
  return /[+*/×÷]/.test(text) || /\d\s*[-−]/.test(text);
}

/**
 * Evaluate a simple + − × ÷ expression with normal precedence (no parentheses).
 * Returns null if it isn't a complete, valid expression. Written by hand rather
 * than eval/Function because Hermes disables those.
 */
function evaluateExpression(expr: string): number | null {
  const tokens = expr.match(/(\d+\.?\d*|\.\d+|[+\-*/])/g);
  if (!tokens) return null;

  const nums: number[] = [];
  const ops: string[] = [];
  let expectNumber = true;
  let sign = 1;

  for (const t of tokens) {
    if (t === '+' || t === '-' || t === '*' || t === '/') {
      if (expectNumber) {
        if (t === '-') sign = -sign;
        else if (t !== '+') return null; // * or / with no left operand
        continue;
      }
      ops.push(t);
      expectNumber = true;
    } else {
      const n = Number.parseFloat(t) * sign;
      sign = 1;
      if (!Number.isFinite(n)) return null;
      nums.push(n);
      expectNumber = false;
    }
  }
  if (expectNumber || nums.length !== ops.length + 1) return null; // trailing operator

  // First pass: × and ÷. Second pass: + and −.
  const values = [nums[0]];
  const addSub: string[] = [];
  for (let i = 0; i < ops.length; i++) {
    const next = nums[i + 1];
    if (ops[i] === '*') values[values.length - 1] *= next;
    else if (ops[i] === '/') values[values.length - 1] /= next;
    else {
      addSub.push(ops[i]);
      values.push(next);
    }
  }
  let result = values[0];
  for (let i = 0; i < addSub.length; i++) {
    result += addSub[i] === '+' ? values[i + 1] : -values[i + 1];
  }
  return Number.isFinite(result) ? result : null;
}

/**
 * Parse user input into a number of currency units. Accepts a plain number or a
 * simple calculation like "120+80" or "45*3". Returns 0 for empty/invalid.
 */
export function parseAmount(text: string): number {
  const cleaned = text
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/[^0-9.+\-*/]/g, '');
  if (!cleaned) return 0;

  if (/^-?\d*\.?\d+$/.test(cleaned)) {
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  const evaluated = evaluateExpression(cleaned);
  if (evaluated !== null) return evaluated;

  // Only a sum still being TYPED falls back to its first number. A finished
  // one that refuses to evaluate — "1200/0" is the way to get there — is not
  // worth 1200, and saying it is would turn a mistyped digit into a recorded
  // amount. It is worth nothing until it says something.
  if (!/[+\-*/]$/.test(cleaned)) return 0;

  const fallback = Number.parseFloat(cleaned); // e.g. mid-typing "120+"
  return Number.isFinite(fallback) ? fallback : 0;
}

/**
 * A short, symbol-less amount for tight spaces like calendar cells:
 * 950, 1.2k, 12k, 1.4M. Always positive — the color carries the direction.
 */
export function formatCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs < 1000) return String(Math.round(abs));
  if (abs < 10000) return `${oneDecimal(abs / 1000)}k`;
  if (abs < 1000000) return `${Math.round(abs / 1000)}k`;
  return `${oneDecimal(abs / 1000000)}M`;
}

/** "1.2" but "12" — drops a trailing ".0". */
function oneDecimal(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/**
 * What a figure reads as while balances are covered.
 *
 * Fixed width whatever the real amount was — a mask that got longer for
 * larger numbers would leak the very thing it is covering.
 */
export const HIDDEN_AMOUNT = '•••••';
