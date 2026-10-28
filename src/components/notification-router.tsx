import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useSync } from '@/sync/provider';

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

    const data = response.notification.request.content.data as
      | { type?: string; bookId?: string }
      | undefined;
    if (data?.type !== 'chat' || !data.bookId) return;

    handled.current = id;
    router.push(`/shared-chat?book=${encodeURIComponent(data.bookId)}` as Href);
  }, [response, ready, email, router]);

  return null;
}
