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

/**
 * e.g. "14 Jul 2026" — the full date without the weekday.
 *
 * For somewhere a date is repeated down a list and the weekday is just width:
 * a shared statement, where ten rows of "Mon, " add nothing. Never relative,
 * unlike `formatRelativeDay` below — "Today" is wrong the moment the message
 * it is in is read tomorrow.
 */
export function formatShortDate(key: string): string {
  const d = keyToDate(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Whole days from a day key until today. Negative for a key in the future.
 *
 * Both ends are snapped to midnight before subtracting, so "yesterday" is
 * always 1 regardless of the time of day it is asked — which is what makes
 * "owing for 32 days" the same number all day long.
 */
export function daysSince(key: string): number {
  if (!key) return 0;
  const then = keyToDate(key).getTime();
  const now = keyToDate(todayKey()).getTime();
  return Math.round((now - then) / 86400000);
}

/** Friendly label: "Today", "Yesterday", or a full date. */
export function formatRelativeDay(key: string): string {
  if (key === todayKey()) return 'Today';
  if (key === addDays(todayKey(), -1)) return 'Yesterday';
  return formatFullDate(key);
}

/** Time of day for an ISO timestamp, e.g. "3:45 PM". */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * The day and the time together, for the one place that needs both: message
 * info, where "3:45 PM" alone is useless once the message is a week old.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return `${formatRelativeDay(dateKey(d))} at ${formatTime(iso)}`;
}

/** A run of items that share a day, and what that day came to. */
export type DayGroup<T> = {
  day: string;
  net: number;
  data: T[];
};

/**
 * One group per day, in the order the days first appear — so a list already
 * sorted newest-first stays that way. `signed` gives each item's effect on the
 * day's net: positive for money in, negative for money out.
 */
export function groupByDay<T extends { day: string }>(
  items: T[],
  signed: (item: T) => number
): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>();
  for (const item of items) {
    let group = groups.get(item.day);
    if (!group) {
      group = { day: item.day, net: 0, data: [] };
      groups.set(item.day, group);
    }
    group.data.push(item);
    group.net += signed(item);
  }
  return Array.from(groups.values());
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
