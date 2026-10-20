/**
 * Export, backup and restore.
 *
 * Lifted out of the Settings page when that became a menu: this is the one
 * section with real machinery behind it (a share sheet, a file picker, a
 * review step), and it was the bulk of what made Settings a single long
 * scroll.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExportSheet } from '@/components/export-sheet';
import { GlassDivider } from '@/components/glass';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Scrim, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { exportBackup, pickBackup, restoreBackup, summarizeBackup, type PickedBackup } from '@/lib/backup';
import { notify } from '@/lib/confirm';
import {
  exportCsv,
  exportPdf,
  type ExportFormat,
  type ExportPeriod,
  type ExportSection,
} from '@/lib/export';

export default function SettingsDataScreen() {
  const theme = useTheme();

  const [exporting, setExporting] = useState<null | ExportFormat>(null);
  // The format outlives the sheet so its title doesn't flicker while it fades out.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetFormat, setSheetFormat] = useState<ExportFormat>('pdf');
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<PickedBackup | null>(null);

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
        notify('Nothing to export', 'There’s nothing in what you picked for this period.');
      else if (res === 'unavailable')
        notify('Unavailable', 'Sharing isn’t available on this device.');
    } catch {
      notify('Export failed', 'Something went wrong creating the file. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const createBackup = async () => {
    if (backupBusy || restoreBusy) return;
    setBackupBusy(true);
    try {
      const result = await exportBackup();
      if (result === 'unavailable') notify('Unavailable', 'Sharing isn’t available on this device.');
    } catch {
      notify('Backup failed', 'Couldn’t create the backup file. Please try again.');
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
      notify('Couldn’t open backup', error instanceof Error ? error.message : 'Choose a valid Spendly backup file.');
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
      notify(
        added ? 'Restore complete' : 'Nothing new to import',
        added
          ? `${counts.transactions} expenses or income entries, ${counts.ledgerEntries} loan entries, ${counts.budgets} budgets and ${counts.categories} categories restored. Existing records were kept.`
          : 'All records in this backup already exist here. Nothing was changed.'
      );
    } catch {
      notify('Restore failed', 'No backup data was imported. Please try again.');
    } finally {
      setRestoreBusy(false);
    }
  };

  const restoreSummary = restoreCandidate ? summarizeBackup(restoreCandidate.backup) : null;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Your data' }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            SHARE A COPY
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ExportRow
              label="Export as CSV"
              hint="Open in Excel or Google Sheets"
              icon="table-chart"
              busy={exporting === 'csv'}
              onPress={() => openExport('csv')}
            />
            <GlassDivider />
            <ExportRow
              label="Export as PDF"
              hint="A tidy printable statement"
              icon="picture-as-pdf"
              busy={exporting === 'pdf'}
              onPress={() => openExport('pdf')}
            />
          </ThemedView>

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            BACKUP
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ExportRow
              label="Create JSON backup"
              hint="Save a restorable copy of your personal data"
              icon="backup"
              busy={backupBusy}
              onPress={createBackup}
            />
            <GlassDivider />
            <ExportRow
              label="Restore from backup"
              hint="Review the file before importing"
              icon="restore"
              busy={restoreBusy}
              onPress={chooseBackup}
            />
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            A backup holds your own entries, categories and budgets. Shared books and receipt
            photos aren&apos;t included.
          </ThemedText>
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
          <View style={[styles.restoreCard, theme.glassOverlay]}>
            <ThemedText type="smallBold" style={styles.restoreTitle}>
              Review backup
            </ThemedText>
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
              Import adds records that aren&apos;t here yet. Existing records are kept. Shared books
              and receipt photos aren&apos;t copied; receipt links are kept only for the same account.
            </ThemedText>
            <View style={styles.restoreActions}>
              <Pressable
                onPress={() => setRestoreCandidate(null)}
                style={({ pressed }) => [styles.restoreButton, theme.glassWeak, pressed && styles.pressed]}>
                <ThemedText type="smallBold">Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={importBackup}
                disabled={restoreBusy}
                style={({ pressed }) => [
                  styles.restoreButton,
                  { backgroundColor: theme.accent },
                  restoreBusy && styles.disabled,
                  pressed && styles.pressed,
                ]}>
                {restoreBusy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText type="smallBold" style={styles.restoreLabel}>
                    Import backup
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </View>
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
      <ThemedText type="smallBold" style={{ color: theme.accentTint }}>
        {count}
      </ThemedText>
    </View>
  );
}

function ExportRow({
  label,
  hint,
  icon,
  busy,
  onPress,
}: {
  label: string;
  hint: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.exportRow, pressed && styles.pressed]}>
      <MaterialIcons name={icon} size={22} color={theme.accentTint} />
      <View style={styles.rowText}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      </View>
      {busy ? (
        <ActivityIndicator color={theme.accentTint} />
      ) : (
        <MaterialIcons name="ios-share" size={19} color={theme.textSecondary} />
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
    paddingHorizontal: Spacing.three,
  },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 58,
    paddingVertical: Spacing.two,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  footnote: {
    marginTop: Spacing.three,
    lineHeight: 20,
  },
  restoreBackdrop: {
    flex: 1,
    backgroundColor: Scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  restoreCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.large,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  restoreTitle: {
    fontSize: 19,
    lineHeight: 26,
  },
  restoreCounts: {
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  restoreCount: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  restoreActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  restoreButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restoreLabel: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
});
