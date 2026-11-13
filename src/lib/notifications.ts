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
 *   • shared-book notifications — chat messages, balance reminders,
 *     reactions, entries added / edited / deleted, and someone joining. All
 *     are pushed by the server (supabase/notifications.sql); chat messages are
 *     ALSO raised locally by the realtime channel while the app is open, since
 *     that path is faster. Everything ends up at the one handler below, which
 *     is where the rules that keep this from being annoying live: the
 *     per-phone switches, muted books, nothing about the screen you are
 *     already looking at, and never the same message twice.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getEntryRequest } from '@/db';
import { isBookMuted } from '@/lib/muted-books';
import { isNotifyEnabled } from '@/lib/notification-prefs';

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

/**
 * The Android channel for what happens IN a shared book: entries added,
 * edited or deleted, and someone joining. Separate from chat so either can be
 * silenced in Android's own settings without losing the other. Same rule as
 * above — must match the `channelId` supabase/notifications.sql sends.
 */
export const ACTIVITY_CHANNEL_ID = 'book-activity';

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
 * The shared book whose own screen is open, if any.
 *
 * Same idea as the chat: an entry the other member adds appears on that screen
 * as it lands, so a banner announcing it would only cover the thing it is
 * announcing. Set by the book screen on focus, cleared on blur.
 */
let activeBook: string | null = null;

export function setActiveBook(bookId: string | null): void {
  activeBook = bookId;
}

/**
 * Messages already shown, so the second delivery of one stays quiet.
 *
 * A message can reach a foregrounded app twice: over the realtime socket
 * (which raises a local notification) and as the server's push. Both carry
 * the message id, and whichever arrives first claims it here — the realtime
 * path when it raises its own, the handler when a push gets in first. Bounded
 * because a long session should not grow a set forever.
 */
const presented = new Set<string>();
const PRESENTED_CAP = 200;

function claimPresented(messageId: string): void {
  if (presented.size >= PRESENTED_CAP) presented.clear();
  presented.add(messageId);
}

/**
 * What a notification's data carries.
 *
 *   type      — 'chat' and 'book' for shared books, 'approval' for a change
 *               request on a locked entry, 'reminder' for the daily nudge,
 *               'test' for the test button.
 *   event     — which kind of shared-book notification, matching the switches
 *               in lib/notification-prefs.ts. Older local ones carry none.
 *               For approvals: 'approval' (you're asked) or 'approval_result'.
 *   local     — raised on this phone by the realtime path, not pushed.
 *   requestId — the approval request, on 'approval' notifications.
 */
type NotificationData = {
  type?: string;
  event?: string;
  bookId?: string;
  messageId?: string;
  requestId?: string;
  local?: boolean;
};

/**
 * Approval requests the in-app pop-up has already put in front of you.
 *
 * A request reaches a foregrounded app twice — as a row (which opens the
 * pop-up, see components/entry-request-popup.tsx) and as the server's push.
 * Whichever is second stays quiet.
 */
const approvalsShown = new Set<string>();

/** Claim a request as shown. True if this call was the first to do so. */
export function claimApprovalShown(requestId: string): boolean {
  if (approvalsShown.has(requestId)) return false;
  if (approvalsShown.size >= PRESENTED_CAP) approvalsShown.clear();
  approvalsShown.add(requestId);
  return true;
}

/** True when a shared-book notification should arrive without a sound or a banner. */
function staysQuiet(data: NotificationData): boolean {
  // Asked for your approval, or told how your own request went. These ignore
  // mute and the per-kind switches by design — a request nobody hears about
  // is an entry frozen for a week — so the only quiet case is "already shown".
  if (data.type === 'approval') {
    if (!data.requestId || data.event !== 'approval') return false;
    // A request you're being ASKED about: if its row is already on this
    // phone, the pop-up has it (or is about to) — one announcement is enough.
    // An answer to YOUR request is never in a pop-up, so it always shows.
    const first = claimApprovalShown(data.requestId);
    return !first || !!getEntryRequest(data.requestId);
  }
  if (data.type !== 'chat' && data.type !== 'book') return false;
  const book = data.bookId;
  if (!book) return false;

  const event = data.event ?? (data.type === 'chat' ? 'message' : '');
  // Switched off on the Notifications screen. The server skips these too,
  // but a push already in flight when the switch moved still lands here.
  if (event && !isNotifyEnabled(event)) return true;
  // Muted on this phone — same reasoning.
  if (isBookMuted(book)) return true;
  // Already looking at it.
  if (data.type === 'chat' && book === activeChatBook) return true;
  // Not a balance reminder, though: it changes nothing in the book, so the
  // screen has nothing to show for it and the banner is the only way it lands.
  if (data.type === 'book' && book === activeBook && event !== 'reminder') return true;

  // The same message by both paths: shown once. A LOCAL notification has
  // already claimed its id (presentChatMessage does that before raising it),
  // so only a push is ever the duplicate — checking the local one too would
  // silence every in-app chat notification, which it once did.
  if ((event === 'message' || event === 'reminder') && data.messageId && !data.local) {
    if (presented.has(data.messageId)) return true;
    claimPresented(data.messageId);
  }
  return false;
}

/** Show notifications in the foreground too — except the cases above. */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content.data ?? {}) as NotificationData;
    const quiet = staysQuiet(data);

    return {
      shouldShowBanner: !quiet,
      shouldShowList: !quiet,
      // The daily reminder stays silent (it's a nudge, not news); something
      // the other member did in a shared book is news.
      shouldPlaySound:
        !quiet && (data.type === 'chat' || data.type === 'book' || data.type === 'approval'),
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
 * Create the two shared-book channels: chat, and what happens in the book.
 *
 * HIGH rather than DEFAULT for both: each is the other member doing something
 * that involves you — talking to you, or changing what the two of you owe —
 * which is what a heads-up banner is for. Either can be lowered in Android's
 * settings on its own. Android 13+ also refuses to show the permission prompt
 * until a channel exists, and `getExpoPushTokenAsync` must come after this —
 * so registration calls it first (see lib/push.ts).
 */
export async function ensureSharedChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHAT_CHANNEL_ID, {
    name: 'Shared book chat',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync(ACTIVITY_CHANNEL_ID, {
    name: 'Shared book activity',
    description: 'Entries added, edited or deleted, and people joining',
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
  /** 'reminder' for a balance reminder; ordinary chat otherwise. */
  event: 'message' | 'reminder';
  title: string;
  body: string;
}): Promise<void> {
  try {
    // The server's push got here first and was shown already.
    if (presented.has(message.messageId)) return;

    const perms = await Notifications.getPermissionsAsync();
    if (!perms.granted) return;

    await ensureSharedChannels();
    // Claimed before scheduling, so the server's push for the same message
    // loses the race and is dropped by the handler rather than shown twice.
    claimPresented(message.messageId);
    const data: NotificationData = {
      type: 'chat',
      event: message.event,
      bookId: message.bookId,
      messageId: message.messageId,
      local: true,
    };
    await Notifications.scheduleNotificationAsync({
      content: {
        title: message.title,
        body: message.body,
        data,
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
  await cancelReminders();

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
          // Routes a tap straight to "Add expense" (components/notification-router).
          data: { type: 'reminder' } satisfies NotificationData,
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
  if (chosen === null) {
    await applyReminder(true, DEFAULT_HOUR, DEFAULT_MINUTE);
    return;
  }
  // Already decided. A reminder that is on gets queued afresh, so one
  // scheduled by an older version — before reminders carried the data that
  // routes a tap to "Add expense" — picks it up. Only with permission already
  // granted: this path must never be what puts a prompt in front of someone.
  const prefs = await getReminderPrefs();
  if (!prefs.enabled) return;
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await applyReminder(true, prefs.hour, prefs.minute);
}

/**
 * Cancel the daily reminder (and any pending test), and nothing else.
 *
 * Not `cancelAllScheduledNotificationsAsync`: a chat notification raised a
 * moment ago is also a scheduled notification for its one second, and
 * changing the reminder's time must not swallow it. Reminders from older
 * versions carry no data at all, which is why the test is "not chat" rather
 * than "is a reminder".
 */
async function cancelReminders(): Promise<void> {
  const queued = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    queued
      .filter((request) => !isChat(request.content.data))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
  );
}

function isChat(data: unknown): boolean {
  return (data as NotificationData | null)?.type === 'chat';
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
    // The reminder's own queue — not a chat notification passing through it.
    scheduled: queued.filter((request) => !isChat(request.content.data)).length,
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
      data: { type: 'test' } satisfies NotificationData,
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
