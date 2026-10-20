/**
 * The daily nudge to log what you spent.
 *
 * Turning it on needs the OS notification permission, which can be refused —
 * so the switch only moves once `applyReminder` says the reminder was actually
 * scheduled, rather than showing "on" for something that will never fire.
 */

import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';
import { applyReminder, formatTime, getReminderPrefs } from '@/lib/notifications';

const TIME_PRESETS = [
  { h: 8, m: 0 },
  { h: 13, m: 0 },
  { h: 18, m: 0 },
  { h: 21, m: 0 },
];

export default function SettingsRemindersScreen() {
  const theme = useTheme();
  const [reminder, setReminder] = useState({ enabled: false, hour: 21, minute: 0 });

  useEffect(() => {
    getReminderPrefs().then(setReminder);
  }, []);

  const toggleReminder = async (on: boolean) => {
    const ok = await applyReminder(on, reminder.hour, reminder.minute);
    if (on && !ok) {
      notify(
        'Notifications are off',
        'Turn on notifications for Spendly in your phone settings to get daily reminders.'
      );
      return;
    }
    setReminder((r) => ({ ...r, enabled: on }));
  };

  const pickTime = async (h: number, m: number) => {
    setReminder((r) => ({ ...r, hour: h, minute: m }));
    if (reminder.enabled) await applyReminder(true, h, m);
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Reminders' }} />
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
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
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
});
