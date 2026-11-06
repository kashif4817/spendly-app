/**
 * Working out who owes what when a bill is divided.
 *
 * WHY THIS IS NOT IN THE SCREEN: it was, and that made it the one piece of
 * money arithmetic in the app that could not be tested without a phone. A
 * split writes several entries at once, in a direction that depends on who
 * paid and who was there — exactly the kind of thing that is obvious until it
 * is wrong, and silent when it is. Out here it is a pure function with a
 * table of cases behind it.
 *
 * PEOPLE AND BOOKS ARE THE SAME PROBLEM. A person on your list and the other
 * member of a shared book are both "somebody who was at the table and owes a
 * share"; the only difference is which table the entry lands in afterwards.
 * So one plan covers both, and a split can mix them — four of you ate, two
 * are on your own list, one shares a book with you, one is a stranger.
 *
 * THE RULE BOTH LEDGERS SHARE: they each record what passes between you and
 * ONE other person. So when you pay, every other head becomes an entry. When
 * somebody else pays, only your own share is yours to record — what the rest
 * of the table owes them is between them, and writing those rows would put
 * money in your ledger that never passed through your hands.
 */

/** Somebody at the table that this app knows about. */
export type SplitParty = {
  /** A person's name, or a book's id. Unique within one split. */
  id: string;
  name: string;
  kind: 'person' | 'book';
};

/** One entry a split would write. `owesYou` is the direction, not a judgement. */
export type SplitEntry = {
  party: SplitParty;
  amount: number;
  /** True when they end up owing you; false when you end up owing them. */
  owesYou: boolean;
};

export type SplitPlan = {
  /** How many people the bill divides by, the payer and any strangers included. */
  heads: number;
  /** One head's share, as a whole amount. Nobody owes anybody 33 paisa. */
  share: number;
  /**
   * What the payer covers beyond their own share, because the bill would not
   * divide into whole amounts.
   *
   * 1,000 between three is 333 each and one left over. Somebody has to carry
   * it, and the only fair answer is the person who already handed the money
   * over — asking one guest for 334 while the others pay 333 is the sort of
   * pettiness this app should not put anyone through.
   */
  remainder: number;
  entries: SplitEntry[];
  /**
   * What the entries do NOT cover: your own share when you paid, anybody this
   * app has never heard of, and the rounding that would not divide. Shown so
   * nobody has to work out why the numbers are short.
   */
  unrecorded: number;
};

/** Two decimal places is how money is stored, even where it is not spent. */
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A share is always a WHOLE amount, rounded down.
 *
 * Nobody settles 333.33 — they hand over 333, and in practice the person who
 * paid waves away the rest. Rounding down rather than to nearest keeps every
 * share at or below the true one, so a split can never ask the table for more
 * than the bill.
 */
const whole = (value: number) => Math.floor(value);

const EMPTY: SplitPlan = { heads: 0, share: 0, remainder: 0, entries: [], unrecorded: 0 };

/**
 * Deduplicate the table. The same party can be tapped in the guest list AND
 * named as the payer, and counting them twice would quietly halve everyone's
 * share.
 */
function uniqueParties(parties: SplitParty[]): SplitParty[] {
  const byId = new Map<string, SplitParty>();
  for (const party of parties) byId.set(party.id, party);
  return [...byId.values()];
}

/**
 * How many people the bill divides by.
 *
 * Separate from `planSplit` because it does not need a bill: it is what lets
 * the screen work the other way round, taking what each head pays and
 * arriving at the total, rather than the other way about.
 */
export function countHeads({
  parties,
  withYou = true,
  others = 0,
}: {
  parties: SplitParty[];
  withYou?: boolean;
  others?: number;
}): number {
  return uniqueParties(parties).length + Math.max(0, Math.floor(others)) + (withYou ? 1 : 0);
}

/**
 * Divide a bill between the people and books you picked.
 *
 * `payer` is null when you paid, otherwise the id of one of the parties.
 * `withYou` is whether you were one of the heads — turning it off is how you
 * say "I paid for them", which divides the bill by the others alone.
 * `others` are heads this app knows nothing about: they still change what a
 * share is worth, but there is nowhere to record what they owe.
 */
export function planSplit({
  total,
  parties,
  payer = null,
  withYou = true,
  others = 0,
}: {
  total: number;
  parties: SplitParty[];
  payer?: string | null;
  withYou?: boolean;
  others?: number;
}): SplitPlan {
  // No bill is no plan, and no head count either: "between 4" is a
  // statement about dividing something, and there is nothing to divide.
  if (!(total > 0)) return EMPTY;

  const unique = uniqueParties(parties);
  const heads = countHeads({ parties, withYou, others });
  if (heads < 2) return { ...EMPTY, heads };

  const share = whole(total / heads);
  // A bill too small to give every head a whole unit. There is nothing
  // sensible to record — entries of zero are noise in a ledger.
  if (share <= 0) return { ...EMPTY, heads };

  const remainder = round(total - share * heads);

  let entries: SplitEntry[];
  if (payer === null) {
    // You paid, so every other head this app knows about owes you a share.
    entries = unique.map((party) => ({ party, amount: share, owesYou: true }));
  } else {
    // They paid. Only your own head is yours to record — and only if you
    // were actually one.
    const paying = unique.find((party) => party.id === payer);
    entries = withYou && paying ? [{ party: paying, amount: share, owesYou: false }] : [];
  }

  const recorded = entries.reduce((sum, entry) => sum + entry.amount, 0);
  return { heads, share, remainder, entries, unrecorded: round(total - recorded) };
}

/**
 * Replace the even shares with what was actually agreed.
 *
 * WHY AN EVEN SPLIT IS ONLY EVER A STARTING POINT: four people eat and one
 * of them had a starter, or somebody is short this week and the others wave
 * it through. The division the app does is a sensible first guess, not a
 * ruling — so every share it proposes can be typed over, and what ends up in
 * the box is what ends up in the ledger.
 *
 * An override of zero or less is treated as "no override": a share has to be
 * worth something to be recorded, and an empty box while somebody is still
 * typing should not quietly wipe the figure it replaced.
 *
 * `unrecorded` is recomputed from the amounts that survive, so the screen can
 * always say what the payer is left carrying — which, once the numbers stop
 * being even, is the only way anybody can check the bill still adds up.
 */
export function applyOverrides(
  plan: SplitPlan,
  total: number,
  overrides: Record<string, number>
): SplitPlan {
  if (plan.entries.length === 0) return plan;

  const entries = plan.entries.map((entry) => {
    const override = overrides[entry.party.id];
    return Number.isFinite(override) && override > 0
      ? { ...entry, amount: round(override) }
      : entry;
  });

  const recorded = entries.reduce((sum, entry) => sum + entry.amount, 0);
  return { ...plan, entries, unrecorded: round(total - recorded) };
}
