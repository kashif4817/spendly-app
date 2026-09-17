import { useSyncExternalStore } from 'react';

import { getPeopleView, subscribePeopleView, type PeopleView } from '@/lib/people-view';

/** The Loans tab's layout, re-rendering when the user switches it. */
export function usePeopleView(): PeopleView {
  return useSyncExternalStore(subscribePeopleView, getPeopleView, getPeopleView);
}
