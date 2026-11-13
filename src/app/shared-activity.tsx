import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ChangePills,
  entryName,
  LOG_ICONS,
  memberLabel,
  RequestBar,
  useTone,
  withAlpha,
  type ActivityTone,
} from '@/components/entry-safety';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  getActivitySeenAt,
  getBookRequests,
  getCurrentUserId,
  getEntryLog,
  getSharedEntry,
  markActivitySeen,
  type SharedEntryLog,
  type SharedEntryRequest,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';
import { dateKey, formatRelativeDay, formatShortDate, formatTime, keyToDate } from '@/lib/date';
import {
  changesBetween,
  FREE_EDIT_HOURS,
  isRequestOpen,
  logAfter,
  logBefore,
  requestAfter,
  requestBefore,
  type EntryValues,
} from '@/lib/entry-lock';
import { formatMoney } from '@/lib/money';
import { useSync } from '@/sync/provider';

type IconName = keyof typeof MaterialIcons.glyphMap;

/** One thing that happened, in the order it happened. */
type Event =
  | { kind: 'log'; id: string; iso: string; log: SharedEntryLog }
  | { kind: 'rejected'; id: string; iso: string; request: SharedEntryRequest };

type Filter = 'all' | 'edits' | 'deletes' | 'backdated' | 'requests';

function matches(event: Event, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (event.kind === 'rejected') return filter === 'requests';
  switch (filter) {
    case 'edits':
      return event.log.action === 'edited';
    case 'deletes':
      return event.log.action === 'deleted';
    case 'backdated':
      return event.log.action === 'added_late';
    default:
      // Approved requests are the changes they made, marked with who approved.
      return !!event.log.approved_by;
  }
}

/** Whole days between an entry's date and the day it was added. */
function daysBack(entryDay: string, addedAt: string): number {
  const added = keyToDate(dateKey(new Date(addedAt))).getTime();
  return Math.round((added - keyToDate(entryDay).getTime()) / 86400000);
}

const toneOf = (event: Event): ActivityTone =>
  event.kind === 'rejected' ? 'rejected' : event.log.action;

/**
 * Everything that has happened to a shared book's entries after they were
 * added: edits, deletes, restores, entries dated well back, and requests that
 * were turned down. Approved requests appear as the change they made, marked
 * with who approved it.
 *
 * Both members see exactly this list — it is the server's log, written by a
 * trigger nobody can edit around (supabase/entry-safety.sql). What's new to
 * you is marked until you've been here.
 *
 * Each kind of change has its own colour (see `useTone`): amber edited, red
 * deleted, green restored, violet back-dated, slate turned down.
 */
export default function SharedActivityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { refreshShared } = useSync();
  const params = useLocalSearchParams<{ book?: string }>();
  const bookId = params.book ?? '';
  const me = getCurrentUserId() ?? '';

  const logs = useQuery(() => getEntryLog(bookId), [bookId]);
  const requests = useQuery(() => getBookRequests(bookId), [bookId]);
  const [filter, setFilter] = useState<Filter>('all');

  // Read before it's moved, so what was new when you arrived keeps its mark
  // for as long as you're looking at it.
  const [seenAt] = useState(() => getActivitySeenAt(bookId));
  // Whatever is on screen counts as seen — including a line that arrives while
  // you're looking. (Screens freeze when covered, so this doesn't run then.)
  useEffect(() => {
    markActivitySeen(bookId);
  }, [bookId, logs.length]);

  const open = requests.filter((r) => isRequestOpen(r));

  const events = useMemo<Event[]>(() => {
    const all: Event[] = [
      ...logs.map((log) => ({ kind: 'log' as const, id: log.id, iso: log.created_at, log })),
      ...requests
        .filter((r) => r.status === 'rejected')
        .map((request) => ({
          kind: 'rejected' as const,
          id: `r:${request.id}`,
          iso: request.decided_at ?? request.updated_at,
          request,
        })),
    ];
    return all.sort((a, b) => Date.parse(b.iso) - Date.parse(a.iso));
  }, [logs, requests]);

  const counts: Record<Filter, number> = {
    all: events.length + open.length,
    edits: events.filter((e) => matches(e, 'edits')).length,
    deletes: events.filter((e) => matches(e, 'deletes')).length,
    backdated: events.filter((e) => matches(e, 'backdated')).length,
    requests: events.filter((e) => matches(e, 'requests')).length + open.length,
  };

  /** Newest day first, each day's events newest first. */
  const days = useMemo(() => {
    const groups: { key: string; events: Event[] }[] = [];
    for (const event of events) {
      if (!matches(event, filter)) continue;
      const key = dateKey(new Date(event.iso));
      const last = groups[groups.length - 1];
      if (last?.key === key) last.events.push(event);
      else groups.push({ key, events: [event] });
    }
    return groups;
  }, [events, filter]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await refreshShared(true);
    setRefreshing(false);
  };

  const openEntry = (entryId: string) => {
    if (getSharedEntry(entryId)) {
      router.push(`/shared-entry?id=${encodeURIComponent(entryId)}` as Href);
    } else {
      notify('Entry deleted', 'This entry is no longer in the book. Its details are kept here.');
    }
  };

  const showWaiting = open.length > 0 && (filter === 'all' || filter === 'requests');

  const filters: { key: Filter; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: theme.accent },
    { key: 'edits', label: 'Edited', color: '#F59E0B' },
    { key: 'deletes', label: 'Deleted', color: '#F23D6D' },
    { key: 'backdated', label: 'Back-dated', color: '#8B5CF6' },
    { key: 'requests', label: 'Approvals', color: '#10B981' },
  ];

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Activity' }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <FlatList
          data={days}
          keyExtractor={(day) => day.key}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={theme.accent}
              colors={[theme.accent]}
            />
          }
          ListHeaderComponent={
            <View style={styles.head}>
              {/* The summary and the filter in one row: each pill is a kind of
                  change, its colour, and how many there are. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filters}>
                {filters.map((option) => (
                  <FilterPill
                    key={option.key}
                    label={option.label}
                    count={counts[option.key]}
                    color={option.color}
                    selected={filter === option.key}
                    onPress={() => setFilter(option.key)}
                  />
                ))}
              </ScrollView>

              {showWaiting && (
                <View style={styles.section}>
                  <SectionTitle text="Waiting for an answer" count={open.length} />
                  {open.map((request) => (
                    <RequestBar
                      key={request.id}
                      request={request}
                      me={me}
                      onPress={() =>
                        router.push(`/entry-request?id=${encodeURIComponent(request.id)}` as Href)
                      }
                    />
                  ))}
                </View>
              )}
            </View>
          }
          renderItem={({ item: day }) => (
            <View style={styles.section}>
              <SectionTitle text={formatRelativeDay(day.key)} count={day.events.length} />
              <View style={[styles.dayCard, theme.glass]}>
                {day.events.map((event, index) => (
                  <Fragment key={event.id}>
                    {index > 0 && (
                      <View style={[styles.rowRule, { backgroundColor: theme.hero.divider }]} />
                    )}
                    <ActivityRow
                      event={event}
                      me={me}
                      unseen={
                        event.kind === 'log' &&
                        event.log.actor_id !== me &&
                        event.log.created_at > seenAt
                      }
                      onPress={() =>
                        openEntry(event.kind === 'log' ? event.log.entry_id : event.request.entry_id)
                      }
                    />
                  </Fragment>
                ))}
              </View>
            </View>
          )}
          ListEmptyComponent={
            showWaiting ? null : (
              <View style={styles.empty}>
                <View style={[styles.emptyIcon, theme.glassWeak]}>
                  <MaterialIcons name="history" size={26} color={theme.accentTint} />
                </View>
                <ThemedText type="smallBold">
                  {filter === 'all'
                    ? 'No changes yet'
                    : filter === 'edits'
                      ? 'No edits yet'
                      : filter === 'deletes'
                        ? 'No deletes yet'
                        : filter === 'backdated'
                          ? 'No back-dated entries yet'
                          : 'No approvals yet'}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                  Edits, deletes and back-dated entries show here for both of you.
                </ThemedText>
              </View>
            )
          }
          ListFooterComponent={
            <View style={styles.rules}>
              <MaterialIcons name="lock-outline" size={14} color={theme.textSecondary} />
              <ThemedText themeColor="textSecondary" style={styles.rulesText} numberOfLines={1}>
                Entries lock after {FREE_EDIT_HOURS}h · changes then need approval
              </ThemedText>
            </View>
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

/** A filter that is also a count: "● Edited 4". Filled in its colour when on. */
function FilterPill({
  label,
  count,
  color,
  selected,
  onPress,
}: {
  label: string;
  count: number;
  color: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${count}`}
      style={({ pressed }) => [
        styles.filter,
        selected
          ? { backgroundColor: color, borderColor: withAlpha('#ffffff', 0.35), borderWidth: 1 }
          : theme.glassWeak,
        pressed && styles.pressed,
      ]}>
      {!selected && <View style={[styles.filterDot, { backgroundColor: color }]} />}
      <Text style={[styles.filterLabel, { color: selected ? '#ffffff' : theme.text }]}>{label}</Text>
      <View
        style={[
          styles.filterCount,
          { backgroundColor: selected ? 'rgba(255,255,255,0.25)' : withAlpha(color, 0.16) },
        ]}>
        <Text style={[styles.filterCountText, { color: selected ? '#ffffff' : theme.text }]}>
          {count}
        </Text>
      </View>
    </Pressable>
  );
}

function SectionTitle({ text, count }: { text: string; count?: number }) {
  return (
    <View style={styles.sectionHead}>
      <ThemedText themeColor="textSecondary" style={styles.sectionTitle}>
        {text.toUpperCase()}
      </ThemedText>
      {count != null && (
        <ThemedText themeColor="textSecondary" style={styles.sectionCount}>
          {count}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * One event, compactly: a tinted icon in its kind's colour, "Kashif edited
 * “Lunch”", then exactly what changed as small pills, then the entry's date
 * and who approved it.
 */
function ActivityRow({
  event,
  me,
  unseen,
  onPress,
}: {
  event: Event;
  me: string;
  unseen: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const kind = toneOf(event);
  const tone = useTone(kind);
  const approvedTone = useTone('restored');
  const payer = (id: string | null) => memberLabel(id, me);
  const paid = (values: EntryValues) => `${payer(values.payer_id)} paid`;
  const day = (values: EntryValues) => (values.day ? formatShortDate(values.day) : '—');

  let who: string;
  let verb: string;
  let object: string;
  let changes: ReturnType<typeof changesBetween> = [];
  // A single line in place of the pills: the money, struck through for a delete.
  let summary: { amount: number | null; struck: boolean; rest: string } | null = null;
  let meta: string;
  let note: { icon: IconName; text: string; color: string } | null = null;

  if (event.kind === 'rejected') {
    const r = event.request;
    const before = requestBefore(r);
    who = memberLabel(r.decided_by, me);
    verb = 'turned down';
    object = `${r.requester_id === me ? 'your' : `${memberLabel(r.requester_id, me)}’s`} ${
      r.kind === 'delete' ? 'delete of' : 'change to'
    } ${entryName(before)}`;
    if (r.kind === 'edit') changes = changesBetween(before, requestAfter(r), payer);
    else summary = { amount: r.old_amount, struck: false, rest: `${paid(before)} · ${day(before)}` };
    meta = `Entry of ${day(before)}`;
    if (r.reason) note = { icon: 'format-quote', text: r.reason, color: theme.textSecondary };
  } else {
    const log = event.log;
    const before = logBefore(log);
    const after = logAfter(log);
    who = memberLabel(log.actor_id, me);
    switch (log.action) {
      case 'edited':
        verb = 'edited';
        object = entryName(before);
        changes = changesBetween(before, after, payer);
        meta = `Entry of ${day(before)}`;
        break;
      case 'deleted':
        verb = 'deleted';
        object = entryName(before);
        summary = { amount: before.amount, struck: true, rest: `${paid(before)} · ${day(before)}` };
        meta = 'Removed from the book';
        break;
      case 'restored':
        verb = 'restored';
        object = entryName(after);
        summary = { amount: after.amount, struck: false, rest: `${paid(after)} · ${day(after)}` };
        meta = 'Back in the book';
        break;
      default: {
        // Added for an earlier day: say which, and how far back, so a wrong
        // date stands out. The day heading above says when it was added.
        verb = 'added';
        object = entryName(after);
        summary = { amount: after.amount, struck: false, rest: paid(after) };
        const back = after.day ? daysBack(after.day, log.created_at) : 0;
        meta = `For ${day(after)}${back > 0 ? ` · ${back === 1 ? '1 day' : `${back} days`} back` : ''}`;
      }
    }
    if (log.approved_by) {
      note = {
        icon: 'verified',
        text: `Approved by ${memberLabel(log.approved_by, me)}`,
        color: approvedTone.ink,
      };
    }
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.glassWeak.backgroundColor }]}>
      <View style={[styles.rowIcon, { backgroundColor: tone.soft }]}>
        <MaterialIcons
          name={event.kind === 'rejected' ? 'block' : (LOG_ICONS[event.log.action] ?? 'edit')}
          size={16}
          color={tone.ink}
        />
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <ThemedText style={styles.rowTitle} numberOfLines={2}>
            <Text style={styles.strong}>{who}</Text> {verb} <Text style={styles.strong}>{object}</Text>
          </ThemedText>
          <View style={styles.rowWhen}>
            {unseen && <View style={[styles.unseenDot, { backgroundColor: theme.accent }]} />}
            <ThemedText themeColor="textSecondary" style={styles.time}>
              {formatTime(event.iso)}
            </ThemedText>
          </View>
        </View>

        <ChangePills changes={changes} tone={kind} />

        {summary && (
          <ThemedText themeColor="textSecondary" style={styles.summary} numberOfLines={1}>
            {summary.amount != null && (
              <Text
                style={[
                  styles.summaryAmount,
                  { color: tone.ink },
                  summary.struck && styles.struck,
                ]}>
                {formatMoney(summary.amount)}
              </Text>
            )}
            {summary.amount != null ? '  ·  ' : ''}
            {summary.rest}
          </ThemedText>
        )}

        <View style={styles.metaRow}>
          <ThemedText themeColor="textSecondary" style={styles.meta} numberOfLines={1}>
            {meta}
          </ThemedText>
          {note && (
            <View style={styles.note}>
              <MaterialIcons name={note.icon} size={12} color={note.color} />
              <Text style={[styles.meta, { color: note.color }]} numberOfLines={1}>
                {note.text}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  head: {
    gap: Spacing.three,
  },
  pressed: {
    opacity: 0.8,
  },
  filters: {
    gap: Spacing.two,
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.full,
    paddingLeft: Spacing.three,
    paddingRight: 5,
    paddingVertical: 5,
  },
  filterDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  filterLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  filterCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountText: {
    fontSize: 11.5,
    fontWeight: '800',
  },
  section: {
    gap: Spacing.two,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
  },
  sectionTitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  sectionCount: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  dayCard: {
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  rowRule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 12 + 30 + 10,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  rowBody: {
    flex: 1,
    gap: 5,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  rowTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  strong: {
    fontWeight: '700',
  },
  rowWhen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingTop: 1,
  },
  unseenDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  time: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  summary: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  summaryAmount: {
    fontWeight: '700',
  },
  struck: {
    textDecorationLine: 'line-through',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: Spacing.two,
    rowGap: 2,
  },
  meta: {
    fontSize: 11.5,
    lineHeight: 15,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 1,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  centered: {
    textAlign: 'center',
  },
  rules: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.one,
  },
  rulesText: {
    flexShrink: 1,
    fontSize: 11.5,
    lineHeight: 16,
  },
});
