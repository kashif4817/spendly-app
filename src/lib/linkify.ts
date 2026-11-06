/**
 * Find the things in a message that are worth tapping.
 *
 * WHY: the first real conversation this chat ever carried was two people
 * swapping a GitHub link, and the link sat there as dead text while one of
 * them retyped it into a browser. A thread that can't be tapped is a thread
 * people leave for one that can.
 *
 * Deliberately conservative. A false positive turns ordinary words blue and
 * makes them open something when tapped, which is worse than a missed link —
 * so bare hostnames need a known-looking ending, and nothing is matched on
 * punctuation alone.
 */

export type TextPart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string };

/**
 * URLs with a scheme, bare `www.`, bare domains with a common ending, emails
 * and phone numbers — in that order of preference, since the alternation is
 * tried left to right.
 */
const PATTERN = new RegExp(
  [
    // A real URL: scheme, host, and anything that isn't whitespace.
    String.raw`https?://[^\s<>"']+`,
    // www.something — overwhelmingly a link even without the scheme.
    String.raw`www\.[^\s<>"']+`,
    // An email address.
    String.raw`[\w.+-]+@[\w-]+\.[\w.-]+`,
    // A bare domain, but only with an ending people actually write by hand.
    String.raw`\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|dev|app|co|pk|me|gg|sh|ai|xyz)\b(?:/[^\s<>"']*)?`,
    // A phone number: a leading + or 0, then 9 or more digits with the
    // spaces, dashes and brackets people put in them.
    String.raw`[+0]\d[\d\s().-]{8,16}\d`,
  ].join('|'),
  'gi'
);

/** Trailing characters that are almost always sentence punctuation, not URL. */
const TRAILING = /[.,;:!?)\]}'"]+$/;

function toUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  if (raw.includes('@')) return `mailto:${raw}`;
  if (/^[+0]/.test(raw) && /\d{9,}/.test(raw.replace(/\D/g, ''))) {
    return `tel:${raw.replace(/[^\d+]/g, '')}`;
  }
  return `https://${raw}`;
}

/**
 * Split a message into plain runs and tappable ones.
 *
 * Always returns at least one part, so a caller can render the result without
 * a special case for "nothing matched".
 */
export function linkify(body: string): TextPart[] {
  const text = body ?? '';
  if (!text) return [{ kind: 'text', text: '' }];

  const parts: TextPart[] = [];
  let at = 0;

  for (const match of text.matchAll(PATTERN)) {
    const start = match.index ?? 0;
    let raw = match[0];

    // "see example.com." ends a sentence; the full stop is not part of the
    // address. Giving it back to the text keeps the sentence readable.
    const trimmed = raw.replace(TRAILING, '');
    if (!trimmed) continue;
    raw = trimmed;

    if (start > at) parts.push({ kind: 'text', text: text.slice(at, start) });
    parts.push({ kind: 'link', text: raw, url: toUrl(raw) });
    at = start + raw.length;
  }

  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts.length > 0 ? parts : [{ kind: 'text', text }];
}

/** True when a message has anything tappable in it. Cheap pre-check. */
export function hasLink(body: string): boolean {
  PATTERN.lastIndex = 0;
  return PATTERN.test(body ?? '');
}
