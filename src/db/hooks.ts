import { useFocusEffect } from 'expo-router';
import * as SQLite from 'expo-sqlite';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

import { iconFor, type CategoryIcon } from '@/constants/categories';
import { getCategories, onDbChanged, type EntryType } from '@/db';

/**
 * How long changes are gathered up before screens re-read the database.
 *
 * `addDatabaseChangeListener` is SQLite's `sqlite3_update_hook`, so it fires
 * once per CHANGED ROW — a sync that applies two hundred pulled rows fired two
 * hundred times, and every `useQuery` on screen re-ran its query on each one.
 * That is what made adding an entry, or opening a book mid-sync, feel like the
 * screen had locked up. One frame's worth of silence collapses a whole batch
 * into a single re-read, and is far too short to notice as lag.
 */
const COALESCE_MS = 50;

// --- One store for every query hook ------------------------------------------
// Each useQuery() used to keep its own counter and its own pair of listeners,
// so a screen with six queries woke up six times per row. They now share one
// version number, which means one coalesced re-render for the whole screen.

let version = 0;
const subscribers = new Set<() => void>();

let nativeSub: { remove: () => void } | null = null;
let unsubscribeBus: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  version += 1;
  for (const notify of subscribers) notify();
}

function schedule(): void {
  // Already waiting to flush — this change rides along with it rather than
  // pushing the flush further out, so a steady stream of writes still gets
  // to the screen promptly.
  if (timer) return;
  timer = setTimeout(flush, COALESCE_MS);
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    // Live updates: any INSERT/UPDATE/DELETE anywhere re-runs dependent queries.
    nativeSub = SQLite.addDatabaseChangeListener(schedule);
    // Also refresh when the connection is swapped (sign-in/out) or a cloud
    // sync pulls remote changes — neither fires the native change listener.
    unsubscribeBus = onDbChanged(schedule);
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size > 0) return;
    nativeSub?.remove();
    nativeSub = null;
    unsubscribeBus?.();
    unsubscribeBus = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

const getVersion = () => version;

/**
 * Re-read every `useQuery` NOW instead of on the usual 50 ms coalesce.
 *
 * For the one case where the delay is visible: a gesture that has just written
 * the new state and is about to drop its own animation. Dragging an entry into
 * place writes the order synchronously, so waiting three frames for the list
 * to agree means the row visibly springs back to where it was and then jumps —
 * the coalesce is doing its job, it is just the wrong job here.
 *
 * Do not reach for this after an ordinary write. The 50 ms is what stops a
 * sync of two hundred rows re-rendering every screen two hundred times.
 */
export function flushQueries(): void {
  if (timer) clearTimeout(timer);
  flush();
}

/**
 * A counter that ticks whenever the database changes or the screen regains
 * focus. Use it as a `useMemo` dependency so queries re-run at the right times.
 */
function useRefreshKey(): [number, number] {
  const dataVersion = useSyncExternalStore(subscribe, getVersion, getVersion);

  // Focus is per-screen rather than global, so it stays a local counter.
  // Refresh when navigating back to a screen (e.g. after the Add modal closes).
  const [focusKey, setFocusKey] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setFocusKey((k) => k + 1);
    }, [])
  );

  return [dataVersion, focusKey];
}

/**
 * Run a synchronous DB query and re-run it on data changes / screen focus.
 *
 *   const entries = useQuery(() => getTransactionsByDay(todayKey()), [dayKey]);
 *
 * `deps` should list any values the query reads besides the database itself.
 */
export function useQuery<T>(query: () => T, deps: React.DependencyList = []): T {
  const [dataVersion, focusKey] = useRefreshKey();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(query, [dataVersion, focusKey, ...deps]);
}

/**
 * Returns a lookup `iconFor(categoryName, type)` backed by the categories
 * table, so rows can show the right icon (with a sensible fallback).
 *
 * The stored value may be an icon name or, on rows written before the switch
 * away from emoji, an actual emoji — `iconFor` resolves either.
 */
export function useCategoryIcon(): (name: string, type: EntryType) => CategoryIcon {
  const categories = useQuery(() => getCategories());
  return useCallback(
    (name: string, type: EntryType) => {
      const match = categories.find((c) => c.name === name && c.type === type);
      return iconFor(match?.emoji);
    },
    [categories]
  );
}
