import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AmountField,
  DateStepper,
  FormCard,
  FormInput,
  FormRow,
  PrimaryButton,
} from '@/components/form';
import { KeyboardAvoider } from '@/components/keyboard-avoider';
import { PersonPickerSheet } from '@/components/person-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CURRENCY, MoneyColors } from '@/constants/app';
import { Radius, Spacing } from '@/constants/theme';
import {
  addLedgerEntry,
  addSharedEntry,
  createPerson,
  deleteLedgerEntry,
  deleteSharedEntry,
  getCurrentUserId,
  getPeople,
  getSharedBookSummaries,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';
import { todayKey } from '@/lib/date';
import { formatMoney, parseAmount } from '@/lib/money';
import { applyOverrides, planSplit, type SplitParty } from '@/lib/split';
import { offerUndo } from '@/lib/undo';

/** Asking the table for more than the bill is a mistake worth colouring. */
const DANGER = '#e5484d';

/**
 * Split one bill between whoever was at the table.
 *
 * WHY THIS EXISTS: the Loans page already knows who everybody is, and the one
 * thing that actually happens — "I paid 3,000 for dinner, there were four of
 * us" — took four trips through the Add loan form, each with the division
 * done in your head. One number and a row of names is the whole of it.
 *
 * PEOPLE AND SHARED BOOKS IN ONE LIST, because a head is a head: your cousin
 * on your own list and the person you share a book with were at the same
 * dinner. Which ledger each share lands in is a detail of where it is
 * recorded, not of who owes it — so the picker does not make you choose a
 * world first and then its people, and one split can touch both.
 *
 * The arithmetic lives in lib/split.ts — see its notes on why only one side
 * of somebody else's bill is yours to record.
 */
export default function SplitScreen() {
  const theme = useTheme();
  const router = useRouter();
  const me = getCurrentUserId() ?? '';

  const people = useQuery(() => getPeople());
  const books = useQuery(() => (me ? getSharedBookSummaries(me) : []), [me]);

  /**
   * Everyone this app could record a share against.
   *
   * Archived people are left out on purpose: they are the ones you have
   * deliberately put away, and a bill is not the moment to bring them back. A
   * book nobody has joined has no second member to owe anything.
   */
  const parties = useMemo<SplitParty[]>(
    () => [
      ...people
        .filter((person) => !person.archived)
        .map((person) => ({
          id: `p:${person.person}`,
          name: person.person,
          kind: 'person' as const,
        })),
      ...books
        .filter((book) => !book.archived && !book.pending)
        .map((book) => ({
          id: `b:${book.id}`,
          name: book.name?.trim() || book.otherName || 'Shared book',
          kind: 'book' as const,
        })),
    ],
    [people, books]
  );

  const [amount, setAmount] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [withYou, setWithYou] = useState(true);
  const [others, setOthers] = useState(0);
  const [note, setNote] = useState('');
  const [day, setDay] = useState(todayKey());
  const [picking, setPicking] = useState(false);
  /**
   * Shares typed over by hand, by party id.
   *
   * Kept as the raw text rather than a number so a half-typed "1" on the way
   * to "150" doesn't momentarily rewrite the row as a 1.
   */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  /**
   * One figure for the whole table, when the even division lands somewhere
   * nobody would actually ask for.
   *
   * 500 between three is 166 each, and what people really say is "just give
   * me 150". Held as its own text rather than read back off the rows, so a
   * half-typed "1." on the way to "150" stays on screen as typed.
   *
   * Null means nothing has been set for everybody — either the shares are
   * still even, or they have been adjusted one by one.
   */
  const [everyone, setEveryone] = useState<string | null>(null);

  const total = useMemo(() => parseAmount(amount), [amount]);
  /**
   * A split always records a bill YOU paid.
   *
   * The other direction — somebody else paid and you owe them a share — is a
   * single loan, and Add loan already does it in one screen without asking
   * who else was at the table. Offering it here meant a "Who paid" row
   * listing every person and book you have, to answer a question that is
   * almost always "me".
   */
  const tint = MoneyColors.in;

  const chosen = useMemo(
    () => parties.filter((party) => picked.includes(party.id)),
    [parties, picked]
  );

  const plan = useMemo(
    () => planSplit({ total, parties: chosen, payer: null, withYou, others }),
    [chosen, others, total, withYou]
  );

  /**
   * Everything that changes what an even share is worth.
   *
   * When any of it moves, hand-typed amounts are dropped: they were answers
   * to a different question, and a stale 150 silently surviving a change of
   * bill is exactly the kind of thing nobody would catch.
   */
  const signature = [total, withYou, others, [...picked].sort().join('|')].join('·');

  useEffect(() => {
    setOverrides({});
    setEveryone(null);
  }, [signature]);

  /** Put one figure against every head at once. */
  const askEveryone = (text: string) => {
    setEveryone(text);
    setOverrides(
      Object.fromEntries(plan.entries.map((entry) => [entry.party.id, text]))
    );
  };

  /**
   * Adjust one head on its own.
   *
   * This ends the "everyone pays the same" state, because they no longer do
   * — and a field still showing 150 while one row says 200 would be lying.
   */
  const askOne = (partyId: string, text: string) => {
    setEveryone(null);
    setOverrides((current) => ({ ...current, [partyId]: text }));
  };

  const evenItOut = () => {
    setOverrides({});
    setEveryone(null);
  };

  /** The plan as agreed, rather than as divided. */
  const finalPlan = useMemo(() => {
    const numeric: Record<string, number> = {};
    for (const [id, text] of Object.entries(overrides)) numeric[id] = parseAmount(text);
    return applyOverrides(plan, total, numeric);
  }, [overrides, plan, total]);

  /** What the others are being asked for in total, and what that leaves. */
  const asked = finalPlan.entries.reduce((sum, entry) => sum + entry.amount, 0);
  const overTheBill = asked > total + 0.005;

  const canSave =
    total > 0 && finalPlan.entries.length > 0 && finalPlan.entries.every((e) => e.amount > 0);

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((p) => p !== id) : [...current, id]
    );

  /**
   * Make somebody new from inside the picker, and put them straight to work.
   *
   * Created AND selected in one go: you only typed their name because you
   * were about to split a bill with them, so landing back on an unchanged
   * form with a new chip to go and find would be half an answer.
   */
  const createAndUse = (name: string): string | void => {
    let made: string;
    try {
      made = createPerson(name);
    } catch (error) {
      return (error as Error).message;
    }
    toggle(`p:${made}`);
  };

  const save = () => {
    if (!canSave) return;
    const label = note.trim() || 'Split';

    /** Undo has to reach into both ledgers, so it remembers which is which. */
    const written: { kind: 'person' | 'book'; id: string }[] = [];

    for (const entry of finalPlan.entries) {
      if (entry.party.kind === 'person') {
        const id = addLedgerEntry({
          person: entry.party.name,
          // You covered their share, so you GAVE it; they covered yours, so
          // you TOOK it. The direction is the whole of what the entry means.
          direction: entry.owesYou ? 'gave' : 'took',
          amount: entry.amount,
          note: label,
          day,
        });
        written.push({ kind: 'person', id });
        continue;
      }

      const bookId = entry.party.id.slice(2);
      const book = books.find((candidate) => candidate.id === bookId);
      if (!book?.otherUserId) continue;
      const id = addSharedEntry({
        bookId,
        // In a book the payer is a member, not a direction: you when they end
        // up owing you, them when you end up owing them.
        payerId: entry.owesYou ? me : book.otherUserId,
        amount: entry.amount,
        note: label,
        day,
      });
      written.push({ kind: 'book', id });
    }

    if (written.length === 0) return;
    offerUndo(written.length === 1 ? 'Split recorded' : `Split between ${finalPlan.heads}`, () => {
      for (const row of written) {
        if (row.kind === 'person') deleteLedgerEntry(row.id);
        else deleteSharedEntry(row.id);
      }
    });
    router.back();
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Split a bill' }} />
      <KeyboardAvoider style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}>
          <AmountField value={amount} onChangeText={setAmount} color={tint} autoFocus />

          <FormCard>
            <FormRow icon="groups" label="Split between">
              <View style={styles.chips}>
                <Chip label="You" on={withYou} onPress={() => setWithYou((on) => !on)} />
                {parties.map((party) => (
                  <Chip
                    key={party.id}
                    label={party.name}
                    icon={party.kind === 'book' ? 'menu-book' : undefined}
                    on={picked.includes(party.id)}
                    onPress={() => toggle(party.id)}
                  />
                ))}
                <AddChip label="Add someone" onPress={() => setPicking(true)} />
              </View>
              {parties.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  Nobody on your list yet — tap “Add someone” to make the first one.
                </ThemedText>
              )}
            </FormRow>

            {/* The heads this app has never heard of. They change what a share
                is worth, which is the only thing it can do about them — there
                is nowhere to record what they owe. */}
            <FormRow icon="person-add-alt" label="Anyone else at the table">
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => setOthers((n) => Math.max(0, n - 1))}
                  hitSlop={8}
                  disabled={others === 0}
                  style={({ pressed }) => [
                    styles.stepBtn,
                    theme.glassWeak,
                    others === 0 && styles.dim,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="One fewer">
                  <MaterialIcons name="remove" size={18} color={theme.text} />
                </Pressable>
                <ThemedText type="smallBold" style={styles.stepValue}>
                  {others === 0 ? 'None' : `${others} more`}
                </ThemedText>
                <Pressable
                  onPress={() => setOthers((n) => Math.min(20, n + 1))}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.stepBtn,
                    theme.glassWeak,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="One more">
                  <MaterialIcons name="add" size={18} color={theme.text} />
                </Pressable>
              </View>
            </FormRow>

            <FormRow icon="notes" label="What for (optional)">
              <FormInput value={note} onChangeText={setNote} placeholder="e.g. Dinner" />
            </FormRow>

            <FormRow icon="event" label="Date">
              <DateStepper day={day} onChange={setDay} color={theme.accent} />
            </FormRow>
          </FormCard>

          {/* The arithmetic, spelled out before anything is written. A split
              is several entries at once, which is exactly the kind of thing
              nobody wants to discover afterwards. */}
          {/* THE SHEET. An even division is a first guess, not a ruling, so
              every figure here can be typed over — and what is in the box is
              what goes into the ledger. */}
          {total > 0 && plan.heads > 1 && (
            <View style={[styles.summary, theme.glass]}>
              <View style={styles.summaryTop}>
                <MaterialIcons name="calculate" size={16} color={theme.accentTint} />
                <ThemedText type="smallBold" style={styles.summaryTitle}>
                  {formatMoney(plan.share)} each, between {plan.heads}
                </ThemedText>
                {Object.keys(overrides).length > 0 && (
                  <Pressable
                    onPress={evenItOut}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Go back to an even split">
                    <ThemedText type="small" style={{ color: theme.accentTint }}>
                      Even it out
                    </ThemedText>
                  </Pressable>
                )}
              </View>

              {/* The whole table in one figure. Optional, like every box in
                  here: leave it alone and the even split above is what gets
                  recorded. */}
              {finalPlan.entries.length > 1 && (
                <View style={[styles.payRow, styles.everyoneRow]}>
                  <MaterialIcons name="groups" size={15} color={theme.accentTint} />
                  <View style={styles.payWho}>
                    <ThemedText type="smallBold">Everyone pays</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {everyone === null ? 'leave blank to keep the split above' : 'the same, each'}
                    </ThemedText>
                  </View>
                  <View style={[styles.payField, theme.glassWeak]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {CURRENCY.trim()}
                    </ThemedText>
                    <TextInput
                      value={everyone ?? ''}
                      onChangeText={askEveryone}
                      placeholder={String(plan.share)}
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      style={[styles.payInput, { color: theme.text }]}
                      accessibilityLabel="What everyone pays"
                    />
                  </View>
                </View>
              )}

              {finalPlan.entries.map((entry) => (
                <View key={entry.party.id} style={styles.payRow}>
                  <MaterialIcons
                    name={entry.party.kind === 'book' ? 'menu-book' : 'person-outline'}
                    size={15}
                    color={theme.textSecondary}
                  />
                  <View style={styles.payWho}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {entry.party.name}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {entry.owesYou ? 'will owe you' : 'you will owe'}
                    </ThemedText>
                  </View>
                  <View style={[styles.payField, theme.glassWeak]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {CURRENCY.trim()}
                    </ThemedText>
                    <TextInput
                      value={overrides[entry.party.id] ?? String(entry.amount)}
                      onChangeText={(text) => askOne(entry.party.id, text)}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      style={[styles.payInput, { color: theme.text }]}
                      accessibilityLabel={`What ${entry.party.name} pays`}
                    />
                  </View>
                </View>
              ))}

              {finalPlan.entries.length === 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  Nothing to record — you were not one of the heads, so none of this bill
                  passed between you and anybody.
                </ThemedText>
              )}

              {/* The line that lets anybody check the bill still adds up once
                  the numbers stop being even. */}
              {finalPlan.entries.length > 0 && (
                <View style={styles.tally}>
                  <ThemedText type="small" themeColor="textSecondary">
                    The others pay {formatMoney(asked)}
                  </ThemedText>
                  <ThemedText
                    type="smallBold"
                    style={{ color: overTheBill ? DANGER : theme.textSecondary }}>
                    {overTheBill
                      ? `${formatMoney(asked - total)} over the bill`
                      : `you cover ${formatMoney(finalPlan.unrecorded)}`}
                  </ThemedText>
                </View>
              )}

              {others > 0 && !overTheBill && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.caveat}>
                  {others === 1 ? 'One head is' : `${others} heads are`} not on your list, so
                  what they owe is part of what you are covering.
                </ThemedText>
              )}

            </View>
          )}

          <PrimaryButton
            label="Record the split"
            onPress={() =>
              canSave
                ? save()
                : notify(
                    'Not enough to split',
                    'Enter an amount and pick at least two heads to divide it between.'
                  )
            }
            color={tint}
          />

          <SafeAreaView edges={['bottom']} />
        </ScrollView>
      </KeyboardAvoider>

      <PersonPickerSheet
        visible={picking}
        title="Split between"
        people={parties.map((party) => party.name)}
        selected={chosen.map((party) => party.name)}
        multi
        onToggle={(name) => {
          const party = parties.find((candidate) => candidate.name === name);
          if (party) toggle(party.id);
        }}
        onCreate={createAndUse}
        onClose={() => setPicking(false)}
      />
    </ThemedView>
  );
}

/**
 * The chip that opens the picker.
 *
 * Deliberately not styled like a name: it is an action that lives in a row of
 * nouns, and a dashed outline is the shortest way to say so.
 */
function AddChip({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        styles.addChip,
        { borderColor: theme.accentTint },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <MaterialIcons name="add" size={14} color={theme.accentTint} />
      <ThemedText type="small" style={{ color: theme.accentTint }} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** One head you can switch on or off. The book mark says which ledger it is. */
function Chip({
  label,
  icon,
  on,
  onPress,
}: {
  label: string;
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  on: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        icon ? styles.chipWithIcon : undefined,
        on ? { backgroundColor: theme.accent } : theme.glassWeak,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}>
      {icon && <MaterialIcons name={icon} size={13} color={on ? '#ffffff' : theme.textSecondary} />}
      <ThemedText type="small" style={on ? styles.chipOn : undefined} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  chip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    maxWidth: 190,
  },
  chipWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipOn: {
    color: '#ffffff',
    fontWeight: '700',
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.one,
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    minWidth: 74,
    textAlign: 'center',
  },
  summary: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  summaryTitle: {
    flex: 1,
  },
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  // Set apart from the per-head rows below it, because it does something
  // different: it writes into all of them at once.
  everyoneRow: {
    paddingBottom: Spacing.two,
    marginBottom: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.35)',
  },
  payWho: {
    flex: 1,
    minWidth: 0,
  },
  // Wide enough for five figures plus the currency without the digits
  // crowding the edge — these are typed into, not just read.
  payField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.medium,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    minWidth: 148,
  },
  payInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
    paddingVertical: 9,
    includeFontPadding: false,
  },
  tally: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  caveat: {
    paddingTop: Spacing.one,
    fontStyle: 'italic',
  },
  dim: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
});
