import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Constants from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { ExportSheet } from '@/components/export-sheet';
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
import {
  exportCsv,
  exportPdf,
  type ExportFormat,
  type ExportPeriod,
  type ExportSection,
} from '@/lib/export';
import { confirm } from '@/lib/confirm';
import { exportBackup, pickBackup, restoreBackup, summarizeBackup, type PickedBackup } from '@/lib/backup';
import { applyReminder, formatTime, getReminderPrefs } from '@/lib/notifications';
import { MODE_OPTIONS, setAccentKey, setAppearanceMode } from '@/lib/appearance';
import { setWeekStart } from '@/lib/week-start';
import { useLock } from '@/lock/provider';
import { useSync } from '@/sync/provider';

const DANGER = '#e5484d';

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
  const [exporting, setExporting] = useState<null | ExportFormat>(null);
  // The format outlives the sheet so its title doesn't flicker while it fades out.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetFormat, setSheetFormat] = useState<ExportFormat>('pdf');
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<PickedBackup | null>(null);

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

  const openExport = (kind: ExportFormat) => {
    if (exporting) return;
    setSheetFormat(kind);
    setSheetOpen(true);
  };

  const doExport = async (kind: ExportFormat, sections: ExportSection[], period: ExportPeriod) => {
    if (exporting) return;
    setExporting(kind);
    try {
      const res = await (kind === 'csv' ? exportCsv(sections, period) : exportPdf(sections, period));
      if (res === 'empty')
        Alert.alert('Nothing to export', 'There’s nothing in what you picked for this period.');
      else if (res === 'unavailable')
        Alert.alert('Unavailable', 'Sharing isn’t available on this device.');
    } catch {
      Alert.alert('Export failed', 'Something went wrong creating the file. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const createBackup = async () => {
    if (backupBusy || restoreBusy) return;
    setBackupBusy(true);
    try {
      const result = await exportBackup();
      if (result === 'unavailable') Alert.alert('Unavailable', 'Sharing isn’t available on this device.');
    } catch {
      Alert.alert('Backup failed', 'Couldn’t create the backup file. Please try again.');
    } finally {
      setBackupBusy(false);
    }
  };

  const chooseBackup = async () => {
    if (backupBusy || restoreBusy) return;
    setRestoreBusy(true);
    try {
      const picked = await pickBackup();
      if (picked) setRestoreCandidate(picked);
    } catch (error) {
      Alert.alert('Couldn’t open backup', error instanceof Error ? error.message : 'Choose a valid Spendly backup file.');
    } finally {
      setRestoreBusy(false);
    }
  };

  const importBackup = () => {
    if (!restoreCandidate || restoreBusy) return;
    setRestoreBusy(true);
    try {
      const counts = restoreBackup(restoreCandidate.backup);
      const added = counts.categories + counts.transactions + counts.budgets + counts.ledgerEntries + counts.people;
      setRestoreCandidate(null);
      Alert.alert(
        added ? 'Restore complete' : 'Nothing new to import',
        added
          ? `${counts.transactions} expenses or income entries, ${counts.ledgerEntries} loan entries, ${counts.budgets} budgets and ${counts.categories} categories restored. Existing records were kept.`
          : 'All records in this backup already exist here. Nothing was changed.'
      );
    } catch {
      Alert.alert('Restore failed', 'No backup data was imported. Please try again.');
    } finally {
      setRestoreBusy(false);
    }
  };

  const restoreSummary = restoreCandidate ? summarizeBackup(restoreCandidate.backup) : null;

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
                          // The swatches sit on a card the same colour as the
                          // page's cards, so a background-coloured ring would
                          // vanish; the ink colour reads on either theme.
                          selected && { borderColor: theme.text },
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
              onPress={() => openExport('csv')}
              color={theme.text}
              secondary={theme.textSecondary}
            />
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <ExportRow
              label="Export as PDF"
              hint="A tidy printable statement"
              icon="picture-as-pdf"
              busy={exporting === 'pdf'}
              onPress={() => openExport('pdf')}
              color={theme.text}
              secondary={theme.textSecondary}
            />
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <ExportRow
              label="Create JSON backup"
              hint="Save a restorable copy of your personal data"
              icon="backup"
              busy={backupBusy}
              onPress={createBackup}
              color={theme.text}
              secondary={theme.textSecondary}
            />
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <ExportRow
              label="Restore from backup"
              hint="Review the file before importing"
              icon="restore"
              busy={restoreBusy}
              onPress={chooseBackup}
              color={theme.text}
              secondary={theme.textSecondary}
            />
          </View>

          <View style={styles.brand}>
            <BrandMark style={styles.brandLogo} />
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

      <ExportSheet
        visible={sheetOpen}
        format={sheetFormat}
        onClose={() => setSheetOpen(false)}
        onExport={(sections, period) => {
          // Close first, then export on the next frame, so the share sheet
          // isn't stranded behind the modal (same reason as ActionSheet).
          setSheetOpen(false);
          requestAnimationFrame(() => doExport(sheetFormat, sections, period));
        }}
      />

      <Modal
        visible={restoreCandidate !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setRestoreCandidate(null)}>
        <View style={styles.restoreBackdrop}>
          <ThemedView type="background" style={styles.restoreCard}>
            <ThemedText type="subtitle">Review backup</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {restoreCandidate?.name}
            </ThemedText>
            {restoreCandidate && (
              <ThemedText type="small" themeColor="textSecondary">
                Created {new Date(restoreCandidate.backup.createdAt).toLocaleString()}
              </ThemedText>
            )}
            {restoreSummary && (
              <View style={styles.restoreCounts}>
                <RestoreCount label="Expenses and income" count={restoreSummary.transactions} />
                <RestoreCount label="Loan entries" count={restoreSummary.ledgerEntries} />
                <RestoreCount label="Budgets" count={restoreSummary.budgets} />
                <RestoreCount label="Categories" count={restoreSummary.categories} />
                <RestoreCount label="People and display settings" count={restoreSummary.people} />
              </View>
            )}
            <ThemedText type="small" themeColor="textSecondary">
              Import adds records that aren’t here yet. Existing records are kept. Shared books and receipt photos aren’t copied; receipt links are kept only for the same account.
            </ThemedText>
            <View style={styles.restoreActions}>
              <Pressable
                onPress={() => setRestoreCandidate(null)}
                style={({ pressed }) => [styles.restoreButton, { backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}>
                <ThemedText type="smallBold">Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={importBackup}
                disabled={restoreBusy}
                style={({ pressed }) => [styles.restoreButton, { backgroundColor: theme.accent }, restoreBusy && styles.disabled, pressed && styles.pressed]}>
                {restoreBusy ? <ActivityIndicator color="#ffffff" /> : <ThemedText type="smallBold" style={styles.restoreLabel}>Import backup</ThemedText>}
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

function RestoreCount({ label, count }: { label: string; count: number }) {
  const theme = useTheme();
  return (
    <View style={styles.restoreCount}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type="smallBold" style={{ color: theme.accent }}>{count}</ThemedText>
    </View>
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
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
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
    borderRadius: 20,
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
  restoreBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  restoreCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 20,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  restoreCounts: {
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  restoreCount: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  restoreActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  restoreButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  restoreLabel: {
    color: '#ffffff',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.7,
  },
});
