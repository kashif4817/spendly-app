import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useSync } from '@/sync/provider';

type NotificationData = { type?: string; bookId?: string; requestId?: string };

/**
 * Where each kind of notification leads:
 *
 *   chat     — a message, a reminder sent as a message, or a reaction → that
 *              book's chat
 *   book     — an entry added, edited or deleted, someone joining, or a
 *              balance reminder (supabase/balance-reminder.sql) → the book
 *              itself, where the change is (a deleted entry has nowhere else
 *              to be shown)
 *   approval — a change request on a locked entry, or the answer to yours →
 *              the request, where it can be approved or turned down
 *   reminder — the daily nudge to log spending → straight to "Add expense"
 *
 * Anything else (the test notification) just opens the app.
 */
function destinationOf(data: NotificationData | undefined): Href | null {
  if (data?.type === 'reminder') return '/entry' as Href;
  if (data?.type === 'approval' && data.requestId) {
    return `/entry-request?id=${encodeURIComponent(data.requestId)}` as Href;
  }
  if (!data?.bookId) return null;
  const book = encodeURIComponent(data.bookId);
  if (data.type === 'chat') return `/shared-chat?book=${book}` as Href;
  if (data.type === 'book') return `/shared-book?id=${book}` as Href;
  return null;
}

/**
 * Takes the user where a tapped notification was about.
 *
 * Renders nothing — it exists because a notification is only half useful if
 * tapping it drops you on the dashboard: the whole reason to be told about a
 * message is to go and read it.
 *
 * `useLastNotificationResponse` rather than a listener, because the two cases
 * are different and a listener only covers one of them. A tap while the app is
 * running fires an event; a tap that LAUNCHES the app happens before any
 * listener could have been registered, and the response is waiting instead.
 * The hook reports both, so this is the one path.
 */
export function NotificationRouter() {
  const router = useRouter();
  const { ready, email } = useSync();
  const response = Notifications.useLastNotificationResponse();
  // The hook keeps handing back the same response, so the id of the one we
  // acted on is remembered — otherwise every re-render would re-navigate.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response) return;
    // Signed out, or still restoring the session: <AuthGate> owns the screen
    // and there is no Stack to push onto yet.
    if (!ready || !email) return;

    const id = response.notification.request.identifier;
    if (handled.current === id) return;

    const target = destinationOf(
      response.notification.request.content.data as NotificationData | undefined
    );
    if (!target) return;

    handled.current = id;
    router.push(target);
  }, [response, ready, email, router]);

  return null;
}
