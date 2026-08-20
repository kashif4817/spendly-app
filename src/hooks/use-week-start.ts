import { useSyncExternalStore } from 'react';

import type { WeekStart } from '@/lib/date';
import { getWeekStart, subscribeWeekStart } from '@/lib/week-start';

/** The weekday weeks start on, re-rendering when the user changes it. */
export function useWeekStart(): WeekStart {
  return useSyncExternalStore(subscribeWeekStart, getWeekStart, getWeekStart);
}
