import { useSyncExternalStore } from 'react';

import { getPeopleSort, subscribePeopleSort, type PeopleSort } from '@/lib/people-sort';

/** The Loans list's order, re-rendering when the user changes it. */
export function usePeopleSort(): PeopleSort {
  return useSyncExternalStore(subscribePeopleSort, getPeopleSort, getPeopleSort);
}
