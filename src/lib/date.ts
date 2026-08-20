/**
 * Date helpers. Everything is done in the device's local time so that "which
 * day did this happen" matches what the user sees on their calendar.
 *
 * A "day key" is an ISO-ish local date string: "YYYY-MM-DD".
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Local "YYYY-MM-DD" for a Date (defaults to now). */
export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's day key. */
export function todayKey(): string {
  return dateKey(new Date());
}

/** Turn a "YYYY-MM-DD" key back into a local Date at midnight. */
export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Add (or subtract) whole days to a day key. */
export function addDays(key: string, days: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** e.g. "Mon, 14 Jul 2026". */
export function formatFullDate(key: string): string {
  const d = keyToDate(key);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Friendly label: "Today", "Yesterday", or a full date. */
export function formatRelativeDay(key: string): string {
  if (key === todayKey()) return 'Today';
  if (key === addDays(todayKey(), -1)) return 'Yesterday';
  return formatFullDate(key);
}

/** First day key of the month containing `key`. */
export function monthStart(key: string): string {
  const d = keyToDate(key);
  return dateKey(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Last day key of the month containing `key`. */
export function monthEnd(key: string): string {
  const d = keyToDate(key);
  return dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** e.g. "Jul 2026". */
export function formatMonth(key: string): string {
  const d = keyToDate(key);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Which weekday a week starts on: 0 = Sunday, 1 = Monday. */
export type WeekStart = 0 | 1;

/** Weeks start on Monday until the user says otherwise. */
export const DEFAULT_WEEK_START: WeekStart = 1;

/** Start of the week containing `key`, for the given first weekday. */
export function weekStart(key: string, startsOn: WeekStart = DEFAULT_WEEK_START): string {
  const d = keyToDate(key);
  const dow = (d.getDay() - startsOn + 7) % 7; // days since the week's first day
  d.setDate(d.getDate() - dow);
  return dateKey(d);
}

/** End of the week containing `key` — always six days after its start. */
export function weekEnd(key: string, startsOn: WeekStart = DEFAULT_WEEK_START): string {
  return addDays(weekStart(key, startsOn), 6);
}

const WEEKDAY_HEADINGS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Two-letter weekday headings in display order, e.g. ["Mo", … , "Su"]. */
export function weekdayHeadings(startsOn: WeekStart = DEFAULT_WEEK_START): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_HEADINGS[(startsOn + i) % 7]);
}

/** e.g. "14 – 20 Jul 2026" (or spanning months/years when needed). */
export function formatWeekRange(startKey: string): string {
  const s = keyToDate(startKey);
  const e = keyToDate(addDays(startKey, 6));
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (sameMonth) {
    return `${s.getDate()} – ${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
  }
  const left = `${s.getDate()} ${MONTHS[s.getMonth()]}`;
  const right = `${e.getDate()} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
  return `${left} – ${right}`;
}

/** Short weekday letter for a key, e.g. "M" "T" — used on the weekly chart. */
export function weekdayLetter(key: string): string {
  return WEEKDAYS[keyToDate(key).getDay()][0];
}

/** Add (or subtract) whole months to a day key. */
export function addMonths(key: string, n: number): string {
  const d = keyToDate(key);
  d.setMonth(d.getMonth() + n);
  return dateKey(d);
}

/** First day key of the year containing `key`. */
export function yearStart(key: string): string {
  const d = keyToDate(key);
  return dateKey(new Date(d.getFullYear(), 0, 1));
}

/** Last day key of the year containing `key`. */
export function yearEnd(key: string): string {
  const d = keyToDate(key);
  return dateKey(new Date(d.getFullYear(), 11, 31));
}

/** "Jul 26" from a "YYYY-MM" month key. */
export function monthKeyLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

/** "Jul" from a "YYYY-MM" month key. */
export function monthShort(monthKey: string): string {
  return MONTHS[Number(monthKey.split('-')[1]) - 1];
}
