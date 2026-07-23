/**
 * Daily "log your spending" reminder via a scheduled local notification.
 * Preferences (on/off + time) live in AsyncStorage; the app only ever schedules
 * this one reminder, so enabling simply cancels any previous one and reschedules.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ENABLED_KEY = 'spendly.reminder.enabled';
const HOUR_KEY = 'spendly.reminder.hour';
const MINUTE_KEY = 'spendly.reminder.minute';
const CHANNEL_ID = 'reminders';

export const DEFAULT_HOUR = 21; // 9:00 PM
export const DEFAULT_MINUTE = 0;

export type ReminderPrefs = {
  enabled: boolean;
  hour: number;
  minute: number;
};

// Show the reminder even if the app happens to be in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
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
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Turn the daily reminder on (at hour:minute) or off. Returns false if the user
 * declined notification permission while enabling.
 */
export async function applyReminder(enabled: boolean, hour: number, minute: number): Promise<boolean> {
  await Notifications.cancelAllScheduledNotificationsAsync();

  if (enabled) {
    const perms = await Notifications.getPermissionsAsync();
    let granted = perms.granted;
    if (!granted) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return false;

    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Track today’s spending 💸',
        body: 'Add what you spent today so your balance stays accurate.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
        channelId: CHANNEL_ID,
      },
    });
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

/** Human label for a time, e.g. "9:00 PM". */
export function formatTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;
}
