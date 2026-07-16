import { useFocusEffect } from 'expo-router';
import * as SQLite from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { FALLBACK_EMOJI } from '@/constants/categories';
import { getCategories, type EntryType } from '@/db';

/**
 * A counter that ticks whenever the database changes or the screen regains
 * focus. Use it as a `useMemo` dependency so queries re-run at the right times.
 */
function useRefreshKey(): number {
  const [key, setKey] = useState(0);
  const bump = useCallback(() => setKey((k) => k + 1), []);

  // Live updates: any INSERT/UPDATE/DELETE anywhere re-runs dependent queries.
  useEffect(() => {
    const sub = SQLite.addDatabaseChangeListener(bump);
    return () => sub.remove();
  }, [bump]);

  // Refresh when navigating back to a screen (e.g. after the Add modal closes).
  useFocusEffect(bump);

  return key;
}

/**
 * Run a synchronous DB query and re-run it on data changes / screen focus.
 *
 *   const entries = useQuery(() => getTransactionsByDay(todayKey()), [dayKey]);
 *
 * `deps` should list any values the query reads besides the database itself.
 */
export function useQuery<T>(query: () => T, deps: React.DependencyList = []): T {
  const key = useRefreshKey();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(query, [key, ...deps]);
}

/**
 * Returns a lookup `emojiFor(categoryName, type)` backed by the categories
 * table, so rows can show the right icon (with a sensible fallback).
 */
export function useCategoryEmoji(): (name: string, type: EntryType) => string {
  const categories = useQuery(() => getCategories());
  return useCallback(
    (name: string, type: EntryType) => {
      const match = categories.find((c) => c.name === name && c.type === type);
      return match?.emoji ?? FALLBACK_EMOJI;
    },
    [categories]
  );
}
