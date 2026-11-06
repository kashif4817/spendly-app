/**
 * Everything the app notifies about, and the one handler that decides whether
 * a notification is shown.
 *
 * Two kinds live here:
 *
 *   • the daily "log your spending" reminder — a scheduled local notification
 *     whose preferences (on/off + time) live in AsyncStorage. The app only
 *     ever schedules this one, so enabling cancels any previous and reschedules.
 *
 *   • shared-book chat — delivered as a push from the server (see
 *     supabase/shared-chat.sql) when the app isn't running, and raised locally
 *     by the realtime channel when it is. Both end up at the same handler,
 *     which is where the two rules that keep chat from being annoying live:
 *     don't notify about the thread the user is currently reading, and don't
 *     show the same message twice when both paths deliver it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { isBookMuted } from '@/lib/muted-books';

const ENABLED_KEY = 'spendly.reminder.enabled';
const HOUR_KEY = 'spendly.reminder.hour';
const MINUTE_KEY = 'spendly.reminder.minute';
/**
 * The reminders channel.
 *
 * VERSIONED, because a channel's importance is fixed the moment Android
 * creates it — `setNotificationChannelAsync` on an existing channel can only
 * change its name and description. The first version of this channel was
 * created at DEFAULT importance, which posts silently into the shade with no
 * banner, and a 9pm nudge that never appears on screen is indistinguishable
 * from one that never fired. A new id is the only way to raise it; the old one
 * is deleted below so it doesn't linger in the phone's settings list.
 */
const CHANNEL_ID = 'reminders-v2';
const LEGACY_CHANNEL_ID = 'reminders';

/**
 * The Android channel chat notifications arrive on.
 *
 * MUST match the `channelId` the server sends (supabase/shared-chat.sql):
 * Android silently drops a notification whose channel doesn't exist on the
 * device, so a mismatch here reads as "push isn't working" with nothing to
 * show for it.
 */
export const CHAT_CHANNEL_ID = 'chat';

export const DEFAULT_HOUR = 21; // 9:00 PM
export const DEFAULT_MINUTE = 0;

export type ReminderPrefs = {
  enabled: boolean;
  hour: number;
  minute: number;
};

/**
 * The book whose chat is open on screen, if any.
 *
 * Buzzing someone about a message they are watching arrive is the fastest way
 * to get notifications turned off altogether, so the handler below mutes a
 * thread while it is being read. Set by the chat screen on focus and cleared
 * on blur.
 */
let activeChatBook: string | null = null;

export function setActiveChatBook(bookId: string | null): void {
  activeChatBook = bookId;
}

/**
 * Messages already shown, so the second delivery of one stays quiet.
 *
 * A message can reach a foregrounded app twice: once over the realtime socket
 * (which raises a local notification straight away) and once as the server's
 * push. They carry the same message id, so the loser of that race is dropped
 * here. Bounded because a long session should not grow a set forever.
 */
const presented = new Set<string>();
const PRESENTED_CAP = 200;

/** Remember a message as shown. Called just before raising a local one. */
export function markChatPresented(messageId: string): void {
  if (presented.size >= PRESENTED_CAP) presented.clear();
  presented.add(messageId);
}

/** Show notifications in the foreground too — except the two cases above. */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as
      | { type?: string; bookId?: string; messageId?: string }
      | undefined;

    const mute =
      data?.type === 'chat' &&
      ((!!data.bookId && data.bookId === activeChatBook) ||
        // Silenced on this device. Checked here rather than at send time
        // because the server has no business knowing which of someone's
        // phones they have chosen to keep quiet.
        (!!data.bookId && isBookMuted(data.bookId)) ||
        (!!data.messageId && presented.has(data.messageId)));

    return {
      shouldShowBanner: !mute,
      shouldShowList: !mute,
      // The reminder stays silent (it's a nudge, not news); a message from the
      // other member is news.
      shouldPlaySound: !mute && data?.type === 'chat',
      shouldSetBadge: false,
    };
  },
});

export async function getReminderPrefs(): Promise<ReminderPrefs> {
  const [enabled, hour, minute] = await Promise.all([
    AsyncStorage.getItem(ENABLED_KEY),
    AsyncStorage.getItem(HOUR_KEY),
    AsyncStorage.getItem(MINUTE_KEY),
  ]);
  return {
    enabled: enabled === '1',
    hour: hour != null ? Number(hour) : DEFAULT_HOUR,
    minute: minute != null ? Number(minute) : DEFAULT_MINUTE,
  };
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Daily reminder',
    // HIGH, so it arrives as a banner rather than appearing silently in the
    // shade hours after anyone would have looked.
    importance: Notifications.AndroidImportance.HIGH,
  });
  // Tidy up the channel this replaced, on devices that already have it.
  await Notifications.deleteNotificationChannelAsync(LEGACY_CHANNEL_ID).catch(() => {});
}

/**
 * Create the chat channel.
 *
 * HIGH rather than DEFAULT: a message in a shared book is someone talking to
 * you, which is the one thing in this app worth a heads-up banner. Android
 * 13+ also refuses to show the permission prompt until a channel exists, and
 * `getExpoPushTokenAsync` must come after this — so registration calls it
 * first (see lib/push.ts).
 */
export async function ensureChatChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHAT_CHANNEL_ID, {
    name: 'Shared book chat',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/**
 * Ask for notification permission if it hasn't been settled yet.
 *
 * Returns whether it is granted. Separated from `applyReminder` so chat can
 * ask for itself: a user who turned the daily reminder off still wants to hear
 * about a message.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Raise a chat notification on this device, now.
 *
 * Used when the realtime socket delivers a message while the app is awake —
 * the server's push is the path for everything else. Best-effort: a missing
 * permission is a quiet no-op, not an error the chat screen has to handle.
 */
export async function presentChatMessage(message: {
  messageId: string;
  bookId: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (!perms.granted) return;

    await ensureChatChannel();
    // Claimed before scheduling, so the server's push for the same message
    // loses the race and is dropped by the handler rather than shown twice.
    markChatPresented(message.messageId);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: message.title,
        body: message.body,
        data: { type: 'chat', bookId: message.bookId, messageId: message.messageId },
      },
      // `trigger: null` fires instantly but has nowhere to name a channel, so
      // Android would file it under the fallback "Miscellaneous" channel —
      // meaning someone who muted "Shared book chat" would still be buzzed by
      // the in-app path. A one-second interval trigger is the shortest form
      // that takes a channelId, and a second's delay on a notification you are
      // only seeing because you're elsewhere in the app costs nothing.
      trigger:
        Platform.OS === 'android'
          ? {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 1,
              channelId: CHAT_CHANNEL_ID,
            }
          : null,
    });
  } catch {
    // Notifications are a courtesy; the message is already in the thread.
  }
}

/**
 * Turn the daily reminder on (at hour:minute) or off. Returns false if the user
 * declined notification permission while enabling.
 */
export async function applyReminder(enabled: boolean, hour: number, minute: number): Promise<boolean> {
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (enabled) {
    // THE CHANNEL COMES FIRST, and the order is the whole fix.
    //
    // On Android 13+ the notification permission prompt will not appear until
    // the app has a channel to attach it to. Asking first meant
    // `requestPermissionsAsync` returned "not granted" without ever showing
    // the user a dialog — so the switch bounced back with "notifications are
    // off" for someone who had never been asked, and no amount of tapping it
    // could ever succeed.
    await ensureAndroidChannel();
    if (!(await ensureNotificationPermission())) return false;

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Track today’s spending',
          body: 'Add what you spent today so your balance stays accurate.',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          channelId: CHANNEL_ID,
        },
      });
    } catch {
      // Scheduling itself was refused. Reported rather than swallowed: the
      // preference is deliberately NOT saved, so the switch stays off instead
      // of promising a reminder that was never queued.
      return false;
    }
  }

  await AsyncStorage.multiSet([
    [ENABLED_KEY, enabled ? '1' : '0'],
    [HOUR_KEY, String(hour)],
    [MINUTE_KEY, String(minute)],
  ]);
  return true;
}

/**
 * Turn the daily reminder on at the default time the first time the app runs
 * (unless the user has already chosen on/off). Best-effort — needs notification
 * permission, which it requests.
 */
export async function ensureDefaultReminder(): Promise<void> {
  const chosen = await AsyncStorage.getItem(ENABLED_KEY);
  if (chosen !== null) return; // user already decided
  await applyReminder(true, DEFAULT_HOUR, DEFAULT_MINUTE);
}

/**
 * What the OS will actually let through, and what it has queued.
 *
 * WHY THIS EXISTS: "the reminder doesn't work" has three completely different
 * causes — permission refused, nothing scheduled, or the phone silently
 * dropping an alarm it did accept — and from inside the app they look
 * identical. Each needs a different fix and only one of them is a bug here, so
 * the screen asks the OS rather than guessing.
 */
export type ReminderStatus = {
  /** Whether we may post a notification at all. */
  permission: 'granted' | 'denied' | 'undetermined';
  /** How many notifications the OS is actually holding for us. */
  scheduled: number;
  /** When the daily reminder next fires, or null if it isn't set. */
  nextAt: Date | null;
};

export async function getReminderStatus(): Promise<ReminderStatus> {
  const [perms, queued, prefs] = await Promise.all([
    Notifications.getPermissionsAsync(),
    Notifications.getAllScheduledNotificationsAsync(),
    getReminderPrefs(),
  ]);

  let nextAt: Date | null = null;
  if (prefs.enabled) {
    try {
      const at = await Notifications.getNextTriggerDateAsync({
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: prefs.hour,
        minute: prefs.minute,
      });
      if (at) nextAt = new Date(at);
    } catch {
      // Not every platform can answer this. The count above still tells us
      // whether anything is queued, which is the part that matters.
    }
  }

  return {
    permission: perms.granted ? 'granted' : perms.canAskAgain ? 'undetermined' : 'denied',
    scheduled: queued.length,
    nextAt,
  };
}

/**
 * Post a notification in a few seconds' time.
 *
 * The delay is the whole point: it is long enough to put the app in the
 * background first, which is the only way to tell "notifications reach this
 * phone" from "notifications reach this phone while I am looking at it". If
 * this one arrives and the daily reminder never does, the app is scheduling
 * correctly and the phone is dropping the alarm — which is a battery setting,
 * not a bug.
 */
export async function sendTestNotification(): Promise<boolean> {
  // Same order as above, and for the same reason.
  await ensureAndroidChannel();
  if (!(await ensureNotificationPermission())) return false;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Spendly test',
      body: 'Reminders can reach you. The daily one will look like this.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      channelId: CHANNEL_ID,
    },
  });
  return true;
}

/** Human label for a time, e.g. "9:00 PM". */
export function formatTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;
}
