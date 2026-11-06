/**
 * Matching one typed name against the people you already have.
 *
 * WHY THIS IS ITS OWN FILE: three different screens were doing it with
 * `includes()`, and `includes()` is wrong about names in a way that only
 * shows up with real ones. "Mudasir Nawaz" CONTAINS "sir". So typing Sir
 * suggested two people called Mudasir, and adding somebody called Sir was met
 * with "you already have Mudasir Nawaz" — which is not a near-duplicate, it
 * is a coincidence of letters in the middle of a word.
 *
 * Names are matched the way every contacts app matches them: on the start of
 * a WORD. Sir matches Sir and Sirajuddin; it does not match Mudasir, because
 * no word of Mudasir Nawaz begins with it.
 */

/** Lowercase, trimmed, single-spaced — the form every comparison here uses. */
export function normaliseName(name: string): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Should this name show up for what has been typed so far?
 *
 * True when the whole name starts with the query, or when any word of it
 * does. The first case is what lets a multi-word query keep working once a
 * space has been typed ("mudasir na"); the second is what makes a surname
 * findable without the first name.
 */
export function matchesQuery(name: string, query: string): boolean {
  const needle = normaliseName(query);
  if (!needle) return true;

  const subject = normaliseName(name);
  if (subject.startsWith(needle)) return true;
  return subject.split(' ').some((word) => word.startsWith(needle));
}

/**
 * Are these two names probably the same person spelled two ways?
 *
 * Only when one is the other plus whole words on the front or the back —
 * "Ali" against "Ali Bhai", "Nawaz" against "Mudasir Nawaz". That is the
 * mistake that actually happens, and it is the only one worth interrupting
 * somebody over.
 *
 * Deliberately NOT true for "Sir" against "Mudasir", and not for "Ali"
 * against "Alina": a name that merely contains another one is a different
 * name, and warning about it trains people to dismiss the warning.
 *
 * Identical names are somebody else's problem — `createPerson` refuses those
 * outright, with a better message than this could give.
 */
export function looksLikeSameName(a: string, b: string): boolean {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (!left || !right || left === right) return false;

  const extendsIt = (shorter: string, longer: string) =>
    longer.startsWith(`${shorter} `) || longer.endsWith(` ${shorter}`);

  return extendsIt(left, right) || extendsIt(right, left);
}
