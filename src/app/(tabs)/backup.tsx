import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  Accents,
  ACCENT_KEYS,
  BottomTabInset,
  MaxContentWidth,
  Spacing,
} from '@/constants/theme';
import { useAccentKey, useAppearanceMode } from '@/hooks/use-appearance';
import { useTheme } from '@/hooks/use-theme';
import { useWeekStart } from '@/hooks/use-week-start';
import { exportCsv, exportPdf } from '@/lib/export';
import { confirm } from '@/lib/confirm';
import { applyReminder, formatTime, getReminderPrefs } from '@/lib/notifications';
import { MODE_OPTIONS, setAccentKey, setAppearanceMode } from '@/lib/appearance';
import { setWeekStart } from '@/lib/week-start';
import { useLock } from '@/lock/provider';
import { useSync } from '@/sync/provider';

const DANGER = '#e5484d';
const LOGO = require('../../../assets/images/spendly-logo.png');

/**
 * "Version 1.0.0 · 3f9ac2b1" — the app version plus the short id of the OTA
 * update actually running, so what's live on a device is always identifiable.
 * Falls back to just the version where expo-updates isn't available (Expo Go,
 * dev builds).
 */
function buildLabel(): string {
  const version = Constants.expoConfig?.version ?? '';
  try {
    if (Updates.isEnabled && Updates.updateId) {
      return `Version ${version} · ${Updates.updateId.slice(0, 8)}`;
    }
  } catch {
    // updates module unavailable — the version alone is fine
  }
  return version ? `Version ${version}` : '';
}
const TIME_PRESETS = [
  { h: 8, m: 0 },
  { h: 13, m: 0 },
  { h: 18, m: 0 },
  { h: 21, m: 0 },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { name, email, status, lastSyncedAt, failure, syncNow, logOut } = useSync();
  const { enabled: lockEnabled } = useLock();
  const weekStartsOn = useWeekStart();
  const mode = useAppearanceMode();
  const accentKey = useAccentKey();

  const [reminder, setReminder] = useState({ enabled: false, hour: 21, minute: 0 });
  const [exporting, setExporting] = useState<null | 'csv' | 'pdf'>(null);

  useEffect(() => {
    getReminderPrefs().then(setReminder);
  }, []);

  const statusLabel =
    status === 'syncing' ? 'Syncing…' : status === 'offline' ? 'Offline — will sync later' : 'Backed up';

  const toggleReminder = async (on: boolean) => {
    const ok = await applyReminder(on, reminder.hour, reminder.minute);
    if (on && !ok) {
      Alert.alert(
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

  const doExport = async (kind: 'csv' | 'pdf') => {
    if (exporting) return;
    setExporting(kind);
    try {
      const res = await (kind === 'csv' ? exportCsv() : exportPdf());
      if (res === 'empty') Alert.alert('Nothing to export yet', 'Add a few transactions first.');
      else if (res === 'unavailable')
        Alert.alert('Unavailable', 'Sharing isn’t available on this device.');
    } catch {
      Alert.alert('Export failed', 'Something went wrong creating the file. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const card = { backgroundColor: theme.backgroundElement };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="title" style={styles.title}>
            Settings
          </ThemedText>

          {/* Account */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            ACCOUNT
          </ThemedText>
          <View style={[styles.card, card]}>
            {name ? (
              <>
                <ThemedText type="subtitle" style={styles.name}>
                  {name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {email}
                </ThemedText>
              </>
            ) : (
              <ThemedText type="subtitle" style={styles.name}>
                {email}
              </ThemedText>
            )}
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: theme.accent },
                  status === 'offline' && styles.dotOffline,
                ]}
              />
              <ThemedText type="small">{statusLabel}</ThemedText>
              {lastSyncedAt && (
                <ThemedText type="small" themeColor="textSecondary">
                  · {lastSyncedAt.toLocaleTimeString()}
                </ThemedText>
              )}
            </View>
            <View style={styles.rowBtns}>
              <Pressable
                onPress={syncNow}
                style={({ pressed }) => [styles.smallBtn, { backgroundColor: theme.accent }, pressed && styles.pressed]}>
                <ThemedText style={styles.smallBtnLabel}>Sync now</ThemedText>
              </Pressable>
              <Pressable
                onPress={() =>
              confirm({
                title: 'Sign out?',
                message:
                  'Your data stays safely backed up in the cloud. Sign back in anytime on this or any device to get it all back.',
                confirmLabel: 'Sign out',
                destructive: true,
                onConfirm: logOut,
              })
            }
                style={({ pressed }) => [styles.smallBtn, styles.ghostBtn, pressed && styles.pressed]}>
                <ThemedText type="smallBold" style={{ color: DANGER }}>
                  Sign out
                </ThemedText>
              </Pressable>
            </View>
          </View>

          {/* Security */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            SECURITY
          </ThemedText>
          <Pressable
            onPress={() => router.push('/security' as Href)}
            style={({ pressed }) => [styles.card, styles.linkRow, card, pressed && styles.pressed]}>
            <View style={styles.linkText}>
              <ThemedText type="smallBold">App Lock</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                PIN or fingerprint to open the app
              </ThemedText>
            </View>
            <View style={styles.linkRight}>
              <ThemedText type="small" style={{ color: lockEnabled ? theme.accent : theme.textSecondary }}>
                {lockEnabled ? 'On' : 'Off'}
              </ThemedText>
              <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
            </View>
          </Pressable>

          {/* A row the server refused. Silence here is what turns a single bad
              row into "the app is just offline", so say it out loud. */}
          {failure && (
            <View style={[styles.card, card, styles.failureCard]}>
              <View style={styles.linkRow}>
                <MaterialIcons name="sync-problem" size={22} color={DANGER} />
                <View style={styles.linkText}>
                  <ThemedText type="smallBold" style={{ color: DANGER }}>
                    A change couldn’t be saved to the cloud
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {failure.table} · {failure.op}
                    {failure.code ? ` · ${failure.code}` : ''}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {failure.message}
                  </ThemedText>
                </View>
              </View>
            </View>
          )}

          {/* Appearance */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            APPEARANCE
          </ThemedText>
          <View style={[styles.card, card]}>
            <View style={styles.linkText}>
              <ThemedText type="smallBold">Theme</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                System follows your phone’s light or dark setting
              </ThemedText>
            </View>
            <Segmented options={MODE_OPTIONS} value={mode} onChange={setAppearanceMode} />

            <View style={styles.accentBlock}>
              <View style={styles.linkText}>
                <ThemedText type="smallBold">Accent colour</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Used for buttons, tabs and highlights
                </ThemedText>
              </View>
              <View style={styles.swatches}>
                {ACCENT_KEYS.map((key) => {
                  const selected = key === accentKey;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setAccentKey(key)}
                      style={styles.swatchHit}
                      accessibilityRole="button"
                      accessibilityLabel={Accents[key].label}
                      accessibilityState={{ selected }}>
                      <View
                        style={[
                          styles.swatch,
                          { backgroundColor: Accents[key].color },
                          // The ring is drawn in the page background so it reads
                          // as a gap, whichever theme is on.
                          selected && { borderColor: theme.background },
                        ]}>
                        {selected && <MaterialIcons name="check" size={18} color="#ffffff" />}
                      </View>
                      <ThemedText
                        type="small"
                        themeColor={selected ? 'text' : 'textSecondary'}
                        style={styles.swatchLabel}>
                        {Accents[key].label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Preferences */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            PREFERENCES
          </ThemedText>
          <View style={[styles.card, card]}>
            <View style={styles.linkText}>
              <ThemedText type="smallBold">Week starts on</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Sets the weekly totals on your dashboard, reports and calendar
              </ThemedText>
            </View>
            <Segmented
              options={[
                { label: 'Monday', value: 'mon' },
                { label: 'Sunday', value: 'sun' },
              ]}
              value={weekStartsOn === 1 ? 'mon' : 'sun'}
              onChange={(value) => setWeekStart(value === 'mon' ? 1 : 0)}
            />
          </View>

          {/* Reminders */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            REMINDERS
          </ThemedText>
          <View style={[styles.card, card]}>
            <View style={styles.linkRow}>
              <View style={styles.linkText}>
                <ThemedText type="smallBold">Daily reminder</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  A nudge to log today’s spending
                </ThemedText>
              </View>
              <Switch value={reminder.enabled} onValueChange={toggleReminder} trackColor={{ true: theme.accent }} />
            </View>

            {reminder.enabled && (
              <View style={styles.timeRow}>
                {TIME_PRESETS.map((t) => {
                  const active = reminder.hour === t.h && reminder.minute === t.m;
                  return (
                    <Pressable
                      key={`${t.h}:${t.m}`}
                      onPress={() => pickTime(t.h, t.m)}
                      style={[
                        styles.timeChip,
                        { backgroundColor: active ? theme.accent : theme.backgroundSelected },
                      ]}>
                      <ThemedText type="small" style={{ color: active ? '#ffffff' : theme.text }}>
                        {formatTime(t.h, t.m)}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* Data */}
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            YOUR DATA
          </ThemedText>
          <View style={[styles.card, card]}>
            <ExportRow
              label="Export as CSV"
              hint="Open in Excel or Google Sheets"
              icon="table-chart"
              busy={exporting === 'csv'}
              onPress={() => doExport('csv')}
              color={theme.text}
              secondary={theme.textSecondary}
            />
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <ExportRow
              label="Export as PDF"
              hint="A tidy printable statement"
              icon="picture-as-pdf"
              busy={exporting === 'pdf'}
              onPress={() => doExport('pdf')}
              color={theme.text}
              secondary={theme.textSecondary}
            />
          </View>

          <View style={styles.brand}>
            <Image source={LOGO} style={styles.brandLogo} contentFit="contain" />
            <ThemedText type="smallBold" style={styles.brandName}>
              Spendly
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Made by Kashif Mehmood
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.brandVersion}>
              {buildLabel()}
            </ThemedText>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ExportRow({
  label,
  hint,
  icon,
  busy,
  onPress,
  color,
  secondary,
}: {
  label: string;
  hint: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  busy: boolean;
  onPress: () => void;
  color: string;
  secondary: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.exportRow, pressed && styles.pressed]}>
      <MaterialIcons name={icon} size={24} color={theme.accent} />
      <View style={styles.linkText}>
        <ThemedText type="smallBold" style={{ color }}>
          {label}
        </ThemedText>
        <ThemedText type="small" style={{ color: secondary }}>
          {hint}
        </ThemedText>
      </View>
      {busy ? (
        <ActivityIndicator color={theme.accent} />
      ) : (
        <MaterialIcons name="ios-share" size={20} color={secondary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  brand: {
    alignItems: 'center',
    gap: Spacing.half,
    marginTop: Spacing.six,
  },
  brandLogo: {
    width: 44,
    height: 44,
    marginBottom: Spacing.one,
    opacity: 0.9,
  },
  brandName: {
    fontSize: 16,
    lineHeight: 22,
  },
  brandVersion: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: Spacing.half,
  },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
    marginBottom: Spacing.two,
  },
  failureCard: {
    gap: Spacing.two,
  },
  accentBlock: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  swatches: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  swatchHit: {
    alignItems: 'center',
    gap: Spacing.one,
    flex: 1,
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  swatchLabel: {
    fontSize: 11,
  },
  section: {
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
    letterSpacing: 0.6,
  },
  card: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  name: {
    fontSize: 22,
    lineHeight: 28,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  dotOffline: {
    backgroundColor: '#e5a23d',
  },
  rowBtns: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  smallBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: 'rgba(229,72,77,0.4)',
  },
  smallBtnLabel: {
    color: '#ffffff',
    fontWeight: '700',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkText: {
    flex: 1,
    gap: 1,
  },
  linkRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  timeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  timeChip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.one,
  },
  divider: {
    height: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
