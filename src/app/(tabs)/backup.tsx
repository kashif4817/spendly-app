import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmModal } from '@/components/confirm-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { exportCsv, exportPdf } from '@/lib/export';
import { applyReminder, formatTime, getReminderPrefs } from '@/lib/notifications';
import { useLock } from '@/lock/provider';
import { useSync } from '@/sync/provider';

const ACCENT = '#0B7C4F';
const DANGER = '#e5484d';
const TIME_PRESETS = [
  { h: 8, m: 0 },
  { h: 13, m: 0 },
  { h: 18, m: 0 },
  { h: 21, m: 0 },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { name, email, status, lastSyncedAt, syncNow, logOut } = useSync();
  const { enabled: lockEnabled } = useLock();

  const [confirmSignOut, setConfirmSignOut] = useState(false);
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
              <View style={[styles.dot, status === 'offline' && styles.dotOffline]} />
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
                style={({ pressed }) => [styles.smallBtn, { backgroundColor: ACCENT }, pressed && styles.pressed]}>
                <ThemedText style={styles.smallBtnLabel}>Sync now</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setConfirmSignOut(true)}
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
              <ThemedText type="small" style={{ color: lockEnabled ? ACCENT : theme.textSecondary }}>
                {lockEnabled ? 'On' : 'Off'}
              </ThemedText>
              <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
            </View>
          </Pressable>

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
              <Switch value={reminder.enabled} onValueChange={toggleReminder} trackColor={{ true: ACCENT }} />
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
                        { backgroundColor: active ? ACCENT : theme.backgroundSelected },
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
        </ScrollView>
      </SafeAreaView>

      <ConfirmModal
        visible={confirmSignOut}
        title="Sign out?"
        message="Your data stays safely backed up in the cloud. Sign back in anytime on this or any device to get it all back."
        confirmLabel="Sign out"
        destructive
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          logOut();
        }}
      />
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
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.exportRow, pressed && styles.pressed]}>
      <MaterialIcons name={icon} size={24} color={ACCENT} />
      <View style={styles.linkText}>
        <ThemedText type="smallBold" style={{ color }}>
          {label}
        </ThemedText>
        <ThemedText type="small" style={{ color: secondary }}>
          {hint}
        </ThemedText>
      </View>
      {busy ? (
        <ActivityIndicator color={ACCENT} />
      ) : (
        <MaterialIcons name="ios-share" size={20} color={secondary} />
      )}
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
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
    marginBottom: Spacing.two,
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
    backgroundColor: ACCENT,
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
