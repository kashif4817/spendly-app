/**
 * The pieces of the shared-book safety feature that more than one screen
 * draws: the "Edited" tag, a before → after list, an approval request with its
 * buttons, and a log line.
 *
 * The rule itself is the server's (supabase/entry-safety.sql) and its mirror
 * is lib/entry-lock.ts; nothing here decides anything — it shows what the log
 * and the requests already say, the same way on both members' phones.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { PromptModal } from '@/components/prompt-modal';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import {
  getSharedMemberName,
  type SharedEntry,
  type SharedEntryLog,
  type SharedEntryRequest,
} from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/confirm';
import { formatDateTime } from '@/lib/date';
import {
  changesBetween,
  entryLabel,
  isRequestOpen,
  logAfter,
  logBefore,
  requestAfter,
  requestBefore,
  type FieldChange,
} from '@/lib/entry-lock';
import { formatMoney } from '@/lib/money';
import {
  cancelEntryRequest,
  EntryRequestError,
  respondToEntryRequest,
} from '@/sync/entry-requests';

/** What this reader calls a member: "You", their name, or "They". */
export function memberLabel(userId: string | null, me: string): string {
  if (!userId) return 'Someone';
  if (userId === me) return 'You';
  return getSharedMemberName(userId)?.split(' ')[0] ?? 'They';
}

/** '#RRGGBB' at some opacity — for soft tinted fills behind a coloured mark. */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const n = Number.parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * One colour per kind of change, used the same way everywhere it appears:
 * amber edited, red deleted, green restored, violet back-dated, slate turned
 * down. Kept apart from the accent (which is the user's own choice) and from
 * the blue/rose money colours, so a colour here never reads as "money in".
 *
 *   base — fills and tints
 *   ink  — text and icons on glass, per theme, so it stays readable
 *   soft — the pale tile behind an icon
 */
export type ActivityTone = 'edited' | 'deleted' | 'restored' | 'added_late' | 'rejected';

const TONES: Record<ActivityTone, { base: string; light: string; dark: string }> = {
  edited: { base: '#F59E0B', light: '#B45309', dark: '#FBBF24' },
  deleted: { base: '#F23D6D', light: '#C0325E', dark: '#FF8FAB' },
  restored: { base: '#10B981', light: '#047857', dark: '#34D399' },
  added_late: { base: '#8B5CF6', light: '#6D28D9', dark: '#C4B5FD' },
  rejected: { base: '#64748B', light: '#475569', dark: '#CBD5E1' },
};

export function useTone(kind: ActivityTone): { base: string; ink: string; soft: string } {
  const theme = useTheme();
  const tone = TONES[kind];
  return { base: tone.base, ink: tone[theme.scheme], soft: withAlpha(tone.base, 0.16) };
}

/** An entry by what people call it: its note, quoted, or "an entry". */
export function entryName(values: { note: string | null }): string {
  const note = values.note?.trim();
  return note ? `“${note.length > 32 ? `${note.slice(0, 31)}…` : note}”` : 'an entry';
}

/**
 * Field by field as small inline pills — "AMOUNT PKR 500 → PKR 5,000" — for
 * lists where a full before/after box would be too tall. Coloured by the
 * kind of change they belong to.
 */
export function ChangePills({ changes, tone }: { changes: FieldChange[]; tone: ActivityTone }) {
  const theme = useTheme();
  const { ink } = useTone(tone);
  if (changes.length === 0) return null;
  return (
    <View style={styles.pills}>
      {changes.map((change) => (
        <View key={change.label} style={[styles.changePill, { backgroundColor: withAlpha(TONES[tone].base, 0.11) }]}>
          <Text style={[styles.pillLabel, { color: theme.textSecondary }]}>
            {change.label.toUpperCase()}
          </Text>
          <Text style={[styles.pillBefore, { color: theme.textSecondary }]} numberOfLines={1}>
            {change.before}
          </Text>
          <MaterialIcons name="arrow-forward" size={11} color={ink} />
          <Text style={[styles.pillAfter, { color: ink }]} numberOfLines={1}>
            {change.after}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * A change request still waiting for an answer, as one slim line: who wants
 * to do what, and a button. Pinned above a book's statement and listed in
 * its Activity. Tapping it opens the full request.
 *
 * The other member's request is a call to action — accent-tinted, with a
 * filled "Review". Your own is quiet: it's just waiting.
 */
export function RequestBar({
  request,
  me,
  onPress,
}: {
  request: SharedEntryRequest;
  me: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const forMe = request.requester_id !== me;
  const verb = request.kind === 'delete' ? 'delete' : 'change';
  const name = entryName({ note: request.old_note });
  const quiet = useTone('rejected');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        forMe
          ? `${memberLabel(request.requester_id, me)} wants to ${verb} ${name}. Review.`
          : `Your ${verb} to ${name} is waiting for approval.`
      }
      style={({ pressed }) => [
        styles.bar,
        forMe
          ? { backgroundColor: withAlpha(theme.accent, 0.13), borderColor: withAlpha(theme.accent, 0.4) }
          : [theme.glassWeak],
        pressed && styles.pressed,
      ]}>
      <View
        style={[
          styles.barIcon,
          { backgroundColor: forMe ? theme.accent : quiet.soft },
        ]}>
        <MaterialIcons
          name={forMe ? 'lock-clock' : 'hourglass-top'}
          size={15}
          color={forMe ? '#ffffff' : quiet.ink}
        />
      </View>
      <ThemedText type="small" style={styles.barText} numberOfLines={1}>
        {forMe ? (
          <>
            <Text style={styles.strong}>{memberLabel(request.requester_id, me)}</Text> wants to{' '}
            {verb} <Text style={styles.strong}>{name}</Text>
          </>
        ) : (
          <>
            Your {verb} to <Text style={styles.strong}>{name}</Text> is waiting
          </>
        )}
      </ThemedText>
      <View
        style={[
          styles.barButton,
          forMe
            ? { backgroundColor: theme.accent }
            : { borderWidth: 1, borderColor: theme.hero.divider },
        ]}>
        <Text style={[styles.barButtonText, { color: forMe ? '#ffffff' : theme.textSecondary }]}>
          {forMe ? 'Review' : 'View'}
        </Text>
      </View>
    </Pressable>
  );
}

/** The small "Edited" pill beside an entry that has been changed since it was added. */
export function EditedTag({ onTint }: { onTint?: boolean }) {
  const theme = useTheme();
  const color = onTint ? 'rgba(255,255,255,0.85)' : theme.accentTint;
  return (
    <View
      style={[styles.tag, { borderColor: color }]}
      accessibilityLabel="Edited after it was added">
      <ThemedText style={[styles.tagText, { color }]}>Edited</ThemedText>
    </View>
  );
}

/** A clock beside an entry with a change request waiting on it. */
export function AwaitingMark() {
  const theme = useTheme();
  return (
    <MaterialIcons
      name="hourglass-top"
      size={13}
      color={theme.accentTint}
      accessibilityLabel="Change request waiting for approval"
    />
  );
}

/**
 * Field by field, in an inset box: "AMOUNT   PKR 500 → PKR 5,000". The old
 * value is struck through and quiet, the new one carries the weight — the
 * eye should land on what it is now.
 */
export function ChangeList({ changes }: { changes: FieldChange[] }) {
  const theme = useTheme();
  if (changes.length === 0) return null;
  return (
    <View style={[styles.changes, theme.glassWeak]}>
      {changes.map((change, index) => (
        <View
          key={change.label}
          style={[
            styles.changeRow,
            index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hero.divider },
          ]}>
          <ThemedText themeColor="textSecondary" style={styles.changeLabel}>
            {change.label.toUpperCase()}
          </ThemedText>
          <View style={styles.changeValues}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.before} numberOfLines={2}>
              {change.before}
            </ThemedText>
            <MaterialIcons name="arrow-forward" size={13} color={theme.accentTint} />
            <ThemedText type="smallBold" style={styles.after} numberOfLines={2}>
              {change.after}
            </ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

/** The headline of a request, from the reader's side. */
export function requestHeadline(request: SharedEntryRequest, me: string): string {
  const asker = request.requester_id === me ? 'You' : memberLabel(request.requester_id, me);
  const verb = request.kind === 'delete' ? 'delete' : 'change';
  const open = isRequestOpen(request);
  if (open) {
    return request.requester_id === me
      ? `You asked to ${verb} an entry`
      : `${asker} wants to ${verb} an entry`;
  }
  const answerer = request.decided_by ? memberLabel(request.decided_by, me) : null;
  switch (request.status) {
    case 'approved':
      return `${answerer ?? 'They'} approved ${request.requester_id === me ? 'your' : `${asker}’s`} ${verb}`;
    case 'rejected':
      return `${answerer ?? 'They'} turned down ${request.requester_id === me ? 'your' : `${asker}’s`} ${verb}`;
    case 'cancelled':
      return `${request.requester_id === me ? 'You' : asker} withdrew a request to ${verb} an entry`;
    default:
      return `A request to ${verb} an entry ran out of time`;
  }
}

/**
 * Approve / turn down / withdraw, with the calls and their messages in one
 * place — the pop-up, the request screen and the entry screen all use it.
 */
function report(e: unknown): void {
  notify(
    'Couldn’t send that',
    e instanceof EntryRequestError ? e.message : 'Check your connection and try again.'
  );
}

/** What an answer turned into, when it wasn't the answer itself. */
function explain(result: SharedEntryRequest): void {
  if (result.status === 'expired') {
    notify('Too late', 'This request ran out of time, so nothing was changed.');
  } else if (result.status === 'cancelled') {
    notify(
      'No longer needed',
      'The request was withdrawn, or the entry changed after it was sent, so nothing was changed.'
    );
  }
}

export function useRequestActions() {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<SharedEntryRequest | null>(null);

  const approve = useCallback(async (request: SharedEntryRequest, onDone?: () => void) => {
    setBusy(true);
    try {
      const result = await respondToEntryRequest(request.id, true);
      if (result.status !== 'approved') explain(result);
      onDone?.();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }, []);

  const [afterReject, setAfterReject] = useState<(() => void) | null>(null);

  /** Opens the optional-reason prompt; `submitReject` sends the answer. */
  const rejectThen = useCallback((request: SharedEntryRequest, onDone?: () => void) => {
    setAfterReject(() => onDone ?? null);
    setRejecting(request);
  }, []);

  const submitReject = async (reason: string) => {
    const request = rejecting;
    setRejecting(null);
    if (!request) return;
    setBusy(true);
    try {
      const result = await respondToEntryRequest(request.id, false, reason.trim());
      if (result.status !== 'rejected') explain(result);
      afterReject?.();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
      setAfterReject(null);
    }
  };

  const cancel = useCallback((request: SharedEntryRequest, onDone?: () => void) => {
    confirm({
      title: 'Withdraw this request?',
      message: 'The entry stays as it is. You can ask again later.',
      confirmLabel: 'Withdraw',
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await cancelEntryRequest(request.id);
          onDone?.();
        } catch (e) {
          report(e);
        } finally {
          setBusy(false);
        }
      },
    });
  }, []);

  /** Mount once beside whatever uses these: the optional "why not?" box. */
  const rejectPrompt = (
    <PromptModal
      visible={!!rejecting}
      title="Turn down this request?"
      message="The entry stays as it is. Add a reason if you like — they’ll see it."
      placeholder="Reason (optional)"
      confirmLabel="Turn down"
      onSubmit={(value) => {
        void submitReject(value);
      }}
      onCancel={() => {
        setRejecting(null);
        setAfterReject(null);
      }}
    />
  );

  return { busy, approve, rejectThen, cancel, rejectPrompt };
}

/**
 * One request, fully: who asks for what, the entry as it is, what it would
 * become, and the buttons that fit this reader.
 */
export function RequestCard({
  request,
  me,
  onDone,
  onOpenEntry,
  style,
}: {
  request: SharedEntryRequest;
  me: string;
  /** After an answer or a withdrawal went through. */
  onDone?: () => void;
  onOpenEntry?: () => void;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const { busy, approve, rejectThen, cancel, rejectPrompt } = useRequestActions();
  const open = isRequestOpen(request);
  const mine = request.requester_id === me;
  const payer = (id: string | null) => memberLabel(id, me);
  const before = requestBefore(request);
  const changes =
    request.kind === 'edit' ? changesBetween(before, requestAfter(request), payer) : [];

  return (
    <View style={[styles.card, theme.glass, style]}>
      <View style={styles.cardHead}>
        <MaterialIcons
          name={request.kind === 'delete' ? 'delete-outline' : 'edit'}
          size={18}
          color={theme.accent}
        />
        <ThemedText type="smallBold" style={styles.flex}>
          {requestHeadline(request, me)}
        </ThemedText>
      </View>

      <Pressable
        onPress={onOpenEntry}
        disabled={!onOpenEntry}
        style={({ pressed }) => [styles.entryBox, theme.glassWeak, pressed && styles.pressed]}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {entryLabel(before)}
        </ThemedText>
        <ThemedText type="smallBold">
          {payer(before.payer_id) === 'You' ? 'You paid' : `${payer(before.payer_id)} paid`}{' '}
          {formatMoney(request.old_amount)}
        </ThemedText>
      </Pressable>

      {request.kind === 'delete' ? (
        <ThemedText type="small" themeColor="textSecondary">
          {mine ? 'You asked to delete this entry.' : 'It would be removed from the book for both of you.'}
        </ThemedText>
      ) : (
        <ChangeList changes={changes} />
      )}

      {request.status === 'rejected' && !!request.reason && (
        <ThemedText type="small" themeColor="textSecondary">
          “{request.reason}”
        </ThemedText>
      )}

      <ThemedText type="small" themeColor="textSecondary">
        Asked {formatDateTime(request.created_at)}
        {open ? ` · open until ${formatDateTime(request.expires_at)}` : ''}
      </ThemedText>

      {open && (
        <View style={styles.actions}>
          {busy ? (
            <ActivityIndicator color={theme.accent} style={styles.flex} />
          ) : mine ? (
            <ActionPill
              label="Withdraw request"
              icon="undo"
              color={theme.textSecondary}
              onPress={() => cancel(request, onDone)}
            />
          ) : (
            <>
              <ActionPill
                label="Turn down"
                icon="close"
                color={theme.money.out}
                onPress={() => rejectThen(request, onDone)}
              />
              <ActionPill
                label="Approve"
                icon="check"
                color={theme.money.in}
                filled
                onPress={() => approve(request, onDone)}
              />
            </>
          )}
        </View>
      )}
      {rejectPrompt}
    </View>
  );
}

function ActionPill({
  label,
  icon,
  color,
  filled,
  onPress,
}: {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  filled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink = filled ? '#ffffff' : color;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.pill,
        filled ? { backgroundColor: color } : [theme.glassWeak, { borderColor: color, borderWidth: 1 }],
        pressed && styles.pressed,
      ]}>
      <MaterialIcons name={icon} size={17} color={ink} />
      <ThemedText type="smallBold" style={{ color: ink }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** What a log line says happened, from this reader's side. */
export function logHeadline(log: SharedEntryLog, me: string): string {
  const who = memberLabel(log.actor_id, me);
  switch (log.action) {
    case 'edited':
      return `${who} edited an entry`;
    case 'deleted':
      return `${who} deleted an entry`;
    case 'restored':
      return `${who} restored an entry`;
    default:
      // An add only reaches the log when it's dated more than a week back.
      return `${who} added a back-dated entry`;
  }
}

export const LOG_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  edited: 'edit',
  deleted: 'delete-outline',
  restored: 'restore',
  added_late: 'history',
};

/**
 * An entry's whole story, oldest first: when it was added, then every change.
 * "Added" isn't a log line (adds aren't logged), so it is drawn from the
 * entry itself.
 */
export function EntryHistory({
  entry,
  logs,
  me,
}: {
  entry: SharedEntry;
  logs: SharedEntryLog[];
  me: string;
}) {
  const theme = useTheme();
  const payer = (id: string | null) => memberLabel(id, me);
  const firstValues = logs.length > 0 && logs[0].action !== 'added_late' ? logBefore(logs[0]) : null;

  return (
    <View style={[styles.card, theme.glass]}>
      <ThemedText type="smallBold">History</ThemedText>

      <HistoryStep
        icon="add"
        title={`${memberLabel(entry.author_id, me)} added it`}
        detail={
          firstValues && firstValues.amount != null
            ? `${payer(firstValues.payer_id) === 'You' ? 'You paid' : `${payer(firstValues.payer_id)} paid`} ${formatMoney(firstValues.amount)}`
            : undefined
        }
        when={formatDateTime(entry.posted_at ?? entry.created_at)}
      />

      {logs
        .filter((log) => log.action !== 'added_late')
        .map((log) => (
          <HistoryStep
            key={log.id}
            icon={LOG_ICONS[log.action] ?? 'edit'}
            title={logHeadline(log, me).replace(' an entry', ' it')}
            changes={
              log.action === 'edited'
                ? changesBetween(logBefore(log), logAfter(log), payer)
                : undefined
            }
            when={`${formatDateTime(log.created_at)}${
              log.approved_by ? ` · approved by ${memberLabel(log.approved_by, me)}` : ''
            }`}
          />
        ))}
    </View>
  );
}

function HistoryStep({
  icon,
  title,
  detail,
  changes,
  when,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  detail?: string;
  changes?: FieldChange[];
  when: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.step}>
      <MaterialIcons name={icon} size={16} color={theme.accent} style={styles.stepIcon} />
      <View style={styles.flex}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {!!detail && (
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        )}
        {changes && changes.length > 0 && <ChangeList changes={changes} />}
        <ThemedText type="small" themeColor="textSecondary" style={styles.when}>
          {when}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  strong: {
    fontWeight: '700',
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  pillLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginRight: 2,
  },
  pillBefore: {
    fontSize: 12,
    textDecorationLine: 'line-through',
    flexShrink: 1,
  },
  pillAfter: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 48,
    borderRadius: Radius.medium,
    borderWidth: 1,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
  },
  barIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barText: {
    flex: 1,
    fontSize: 14,
  },
  barButton: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  barButtonText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  tag: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: 6,
    paddingVertical: 0,
  },
  tagText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  changes: {
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  changeLabel: {
    width: 70,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  changeValues: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
  },
  before: {
    textDecorationLine: 'line-through',
  },
  after: {
    flexShrink: 1,
  },
  card: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  entryBox: {
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
    minHeight: 44,
    alignItems: 'center',
  },
  pill: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.medium,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  pressed: {
    opacity: 0.85,
  },
  when: {
    marginTop: 2,
  },
  step: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  stepIcon: {
    marginTop: 2,
  },
});
