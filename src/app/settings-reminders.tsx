/**
 * Notifications: the daily nudge to log what you spent, and a switch for each
 * kind of shared-book notification.
 *
 * Turning the reminder on needs the OS notification permission, which can be
 * refused — so that switch only moves once `applyReminder` says the reminder
 * was actually scheduled, rather than showing "on" for something that will
 * never fire.
 *
 * The shared-book switches are all on until turned off, and apply to this
 * phone only. The server is told too (lib/push.ts), since it is the one that
 * sends them — see lib/notification-prefs.ts for why that has to be so.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useNotifyOff } from '@/hooks/use-notify-prefs';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';
import { dateKey, formatRelativeDay } from '@/lib/date';
import {
  NOTIFY_OPTIONS,
  setNotifyEnabled,
  type NotifyGroup,
} from '@/lib/notification-prefs';
import {
  applyReminder,
  formatTime,
  getReminderPrefs,
  getReminderStatus,
  sendTestNotification,
  type ReminderStatus,
} from '@/lib/notifications';

/** The shared-book switches, a card per group. */
const GROUP_TITLES: Record<NotifyGroup, string> = {
  Chat: 'Shared book chat',
  Entries: 'Shared book entries',
  Members: 'Shared book members',
};
const GROUPS = Object.keys(GROUP_TITLES) as NotifyGroup[];

const TIME_PRESETS = [
  { h: 8, m: 0 },
  { h: 13, m: 0 },
  { h: 18, m: 0 },
  { h: 21, m: 0 },
];

export default function SettingsNotificationsScreen() {
  const theme = useTheme();
  const off = useNotifyOff();
  const [reminder, setReminder] = useState({ enabled: false, hour: 21, minute: 0 });
  const [status, setStatus] = useState<ReminderStatus | null>(null);

  // Re-read after anything that could change it, so the panel below is never
  // describing a state the OS has already moved on from.
  const refresh = useCallback(() => {
    getReminderStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    getReminderPrefs().then(setReminder);
  }, []);

  // On focus, not just on mount: the "Phone settings" button below sends the
  // user out to change the very thing this panel reports, so coming back has
  // to re-ask rather than show what was true before they left.
  useFocusEffect(refresh);

  const toggleReminder = async (on: boolean) => {
    const ok = await applyReminder(on, reminder.hour, reminder.minute);
    if (on && !ok) {
      // Deliberately not "notifications are off" — that was only ever one of
      // the reasons this can fail, and the panel below says which it was.
      notify(
        'Couldn’t set the reminder',
        'Your phone wouldn’t schedule it. See “If it isn’t arriving” below for what it says.'
      );
      refresh();
      return;
    }
    setReminder((r) => ({ ...r, enabled: on }));
    refresh();
  };

  const pickTime = async (h: number, m: number) => {
    setReminder((r) => ({ ...r, hour: h, minute: m }));
    if (reminder.enabled) await applyReminder(true, h, m);
    refresh();
  };

  const runTest = async () => {
    const ok = await sendTestNotification();
    refresh();
    notify(
      ok ? 'Test sent' : 'Notifications are off',
      ok
        ? 'Leave this screen and it should arrive in about five seconds. If it doesn’t, the phone is blocking Spendly rather than Spendly failing to send.'
        : 'Turn on notifications for Spendly in your phone settings first.'
    );
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            DAILY REMINDER
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.row}>
              <View style={styles.copy}>
                <ThemedText type="smallBold">Remind me each day</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  A nudge to log today&apos;s spending
                </ThemedText>
              </View>
              <Switch
                value={reminder.enabled}
                onValueChange={toggleReminder}
                trackColor={{ true: theme.accent }}
              />
            </View>

            {reminder.enabled && (
              <View style={styles.timeRow}>
                {TIME_PRESETS.map((t) => {
                  const active = reminder.hour === t.h && reminder.minute === t.m;
                  return (
                    <Pressable
                      key={`${t.h}:${t.m}`}
                      onPress={() => pickTime(t.h, t.m)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.timeChip,
                        active ? { backgroundColor: theme.accent } : theme.glassWeak,
                      ]}>
                      <ThemedText type="small" style={{ color: active ? '#ffffff' : theme.text }}>
                        {formatTime(t.h, t.m)}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            One reminder a day, at the time you pick. It never includes any of your figures.
          </ThemedText>

          {GROUPS.map((group) => (
            <View key={group}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
                {GROUP_TITLES[group]}
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                {NOTIFY_OPTIONS.filter((option) => option.group === group).map((option) => (
                  <View key={option.event} style={styles.row}>
                    <View style={styles.copy}>
                      <ThemedText type="smallBold">{option.label}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {option.hint}
                      </ThemedText>
                    </View>
                    <Switch
                      value={!off.has(option.event)}
                      onValueChange={(on) => setNotifyEnabled(option.event, on)}
                      trackColor={{ true: theme.accent }}
                      accessibilityLabel={option.label}
                    />
                  </View>
                ))}
              </ThemedView>
            </View>
          ))}

          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            Only ever about your shared books, and never about something you did yourself. These
            apply to this phone. To quiet one book completely, use Mute notifications in its menu.
          </ThemedText>

          {/* Everything below is here because "the reminder didn't arrive" has
              three different causes that look identical from inside the app.
              This says which one it is instead of leaving you to guess. */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            IF IT ISN&apos;T ARRIVING
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <StatusLine
              ok={status?.permission === 'granted'}
              label="Permission"
              value={
                status === null
                  ? 'Checking…'
                  : status.permission === 'granted'
                    ? 'Spendly may send notifications'
                    : status.permission === 'denied'
                      ? 'Blocked in phone settings'
                      : 'Not granted yet'
              }
            />
            <StatusLine
              ok={!!status && status.scheduled > 0}
              label="Queued with the phone"
              value={
                status === null
                  ? 'Checking…'
                  : status.scheduled === 0
                    ? 'Nothing scheduled'
                    : `${status.scheduled} waiting`
              }
            />
            <StatusLine
              ok={!!status?.nextAt}
              label="Next reminder"
              value={
                status === null
                  ? 'Checking…'
                  : status.nextAt
                    ? `${formatRelativeDay(dateKey(status.nextAt))} at ${formatTime(
                        status.nextAt.getHours(),
                        status.nextAt.getMinutes()
                      )}`
                    : 'Not set'
              }
            />

            <View style={styles.actions}>
              <ActionLink icon="notifications-active" label="Send a test" onPress={runTest} />
              <ActionLink
                icon="settings"
                label="Phone settings"
                onPress={() => Linking.openSettings()}
              />
            </View>
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            {Platform.OS === 'android'
              ? 'If the test arrives but the daily reminder never does, the phone is dropping it while Spendly is closed. On Xiaomi, Oppo, Vivo and Samsung phones that is Autostart or battery saving — in phone settings, allow Spendly to run in the background and set its battery use to unrestricted.'
              : 'If the test arrives but the daily reminder never does, check that Spendly is allowed to deliver notifications while in the background.'}
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

/** One line of "here is what the phone says", with a tick or a warning. */
function StatusLine({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.statusLine}>
      <MaterialIcons
        name={ok ? 'check-circle' : 'error-outline'}
        size={18}
        color={ok ? theme.money.in : theme.textSecondary}
      />
      <View style={styles.copy}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {value}
        </ThemedText>
      </View>
    </View>
  );
}

function ActionLink({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, theme.glassWeak, pressed && styles.pressed]}
      accessibilityRole="button">
      <MaterialIcons name={icon} size={18} color={theme.accentTint} />
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
  },
  section: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
    marginLeft: Spacing.half,
  },
  card: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  copy: {
    flex: 1,
    gap: 1,
  },
  timeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  timeChip: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  footnote: {
    marginTop: Spacing.three,
    lineHeight: 20,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    minHeight: 48,
  },
  pressed: {
    opacity: 0.7,
  },
});
