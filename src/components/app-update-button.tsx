import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import { useAppRelease } from '@/hooks/use-app-release';
import { useTheme } from '@/hooks/use-theme';
import {
  cancelUpdateDownload,
  downloadAndInstall,
  UpdateError,
  type UpdateStep,
} from '@/lib/apk-update';
import { INSTALLED_VERSION } from '@/lib/app-release';
import { notify } from '@/lib/confirm';

/**
 * The dashboard's "new version" icon. Renders nothing while the installed
 * build is current; once a newer APK is published it stays put — badge and
 * all — until that version is installed. Tapping it explains what's new;
 * Download then fetches the APK inside the app, checks it arrived intact and
 * opens Android's installer (lib/apk-update.ts). The browser — which once
 * delivered a damaged file Android refused — is only the fallback now.
 */
export function AppUpdateButton() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const release = useAppRelease();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<UpdateStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Progress arrives per network chunk; the bar only needs whole percents.
  const shownPercent = useRef(-1);

  if (!release) return null;

  const onStep = (next: UpdateStep) => {
    if (next.kind === 'downloading' && next.fraction !== null) {
      const percent = Math.floor(next.fraction * 100);
      if (percent === shownPercent.current) return;
      shownPercent.current = percent;
    } else {
      shownPercent.current = -1;
    }
    setStep(next);
  };

  /** Closing stops a download in progress; the next Download starts afresh. */
  const close = () => {
    void cancelUpdateDownload();
    setStep(null);
    setError(null);
    setOpen(false);
  };

  const download = async () => {
    setError(null);
    try {
      await downloadAndInstall(release, onStep);
    } catch (e) {
      setError(e instanceof UpdateError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setStep(null);
    }
  };

  /** The old way, kept for when the in-app download can't finish. */
  const openInBrowser = async () => {
    close();
    try {
      await Linking.openURL(release.downloadUrl);
    } catch {
      notify('Couldn’t open the download', 'Check your internet connection and try again.');
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={4}
        style={({ pressed }) => [
          styles.button,
          theme.glass,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Update available: Spendly ${release.version}`}>
        <MaterialIcons name="system-update" size={22} color={theme.accent} />
        <View style={[styles.badge, { borderColor: theme.background }]} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Dismiss">
          {/* Swallows taps so pressing the sheet itself doesn't close it. */}
          <Pressable onPress={() => {}}>
            {/* The overlay pane every other sheet uses. A plain ThemedView is
                transparent under the Aurora look, so this sheet used to have no
                surface at all and the dashboard showed straight through it. */}
            <View
              style={[
                styles.sheet,
                { ...theme.glassOverlay, paddingBottom: insets.bottom + Spacing.three },
              ]}>
              <View style={[styles.grabber, { backgroundColor: theme.backgroundSelected }]} />

              <View style={styles.head}>
                <View style={[styles.headIcon, { backgroundColor: `${theme.accent}1A` }]}>
                  <MaterialIcons name="system-update" size={24} color={theme.accent} />
                </View>
                <View style={styles.headText}>
                  <ThemedText type="smallBold" style={styles.title}>
                    Update available
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Spendly {release.version} · you have {INSTALLED_VERSION}
                  </ThemedText>
                </View>
              </View>

              {release.notes ? (
                <ThemedView type="backgroundElement" style={styles.notes}>
                  <ScrollView style={styles.notesScroll} nestedScrollEnabled>
                    <ThemedText type="small">{release.notes}</ThemedText>
                  </ScrollView>
                </ThemedView>
              ) : null}

              <ThemedText type="small" themeColor="textSecondary">
                Spendly downloads it, checks it arrived intact, then opens Android’s installer — tap
                Update. It installs over this version and keeps all your data. The first time,
                Android asks you to allow Spendly to install apps.
              </ThemedText>

              {step ? (
                <UpdateProgress step={step} />
              ) : error ? (
                <View style={[styles.errorBox, theme.glassWeak]}>
                  <MaterialIcons name="error-outline" size={18} color={MoneyColors.out} />
                  <ThemedText type="small" style={styles.errorText}>
                    {error}
                  </ThemedText>
                </View>
              ) : null}

              <View style={styles.actions}>
                {step ? (
                  <Pressable
                    onPress={close}
                    style={({ pressed }) => [styles.btn, theme.glass, pressed && styles.pressed]}
                    accessibilityRole="button">
                    <ThemedText type="smallBold">Cancel</ThemedText>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      onPress={error ? openInBrowser : close}
                      style={({ pressed }) => [styles.btn, theme.glass, pressed && styles.pressed]}
                      accessibilityRole="button">
                      <ThemedText type="smallBold">{error ? 'Use browser' : 'Later'}</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={download}
                      style={({ pressed }) => [
                        styles.btn,
                        styles.btnRow,
                        { backgroundColor: theme.accent },
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button">
                      <MaterialIcons name={error ? 'refresh' : 'download'} size={18} color="#ffffff" />
                      <ThemedText type="smallBold" style={styles.downloadLabel}>
                        {error ? 'Try again' : 'Download'}
                      </ThemedText>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** Where the in-app download has got to, as a line of text over a bar. */
function UpdateProgress({ step }: { step: UpdateStep }) {
  const theme = useTheme();
  const fraction = step.kind === 'downloading' ? step.fraction : 1;
  const label =
    step.kind === 'downloading'
      ? fraction === null
        ? 'Downloading…'
        : `Downloading… ${Math.round(fraction * 100)}%`
      : step.kind === 'checking'
        ? 'Checking it arrived intact…'
        : 'Opening the installer…';

  return (
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View
          style={[
            styles.fill,
            // Before the size is known there is nothing to measure against,
            // so a sliver says "started" rather than a bar stuck at zero.
            { backgroundColor: theme.accent, width: `${Math.max((fraction ?? 0.08) * 100, 3)}%` },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 11,
    height: 11,
    borderRadius: 999,
    borderWidth: 2,
    backgroundColor: MoneyColors.out,
  },
  backdrop: {
    flex: 1,
    backgroundColor: Scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.large,
    borderTopRightRadius: Radius.large,
    borderBottomWidth: 0,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  headIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
  },
  notes: {
    borderRadius: Radius.medium,
    padding: Spacing.three,
  },
  notesScroll: {
    maxHeight: 160,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  btn: {
    flex: 1,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  btnRow: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  downloadLabel: {
    color: '#ffffff',
  },
  progress: {
    gap: Spacing.two,
  },
  track: {
    height: 8,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.full,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderRadius: Radius.medium,
    padding: Spacing.three,
  },
  errorText: {
    flex: 1,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.7,
  },
});
