import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { Radius, Spacing } from '@/constants/theme';
import { useAppRelease } from '@/hooks/use-app-release';
import { useTheme } from '@/hooks/use-theme';
import { INSTALLED_VERSION } from '@/lib/app-release';
import { notify } from '@/lib/confirm';

/**
 * The dashboard's "new version" icon. Renders nothing while the installed
 * build is current; once a newer APK is published it stays put — badge and
 * all — until that version is installed. Tapping it explains what's new and
 * hands the APK link to the browser.
 */
export function AppUpdateButton() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const release = useAppRelease();
  const [open, setOpen] = useState(false);

  if (!release) return null;

  const download = async () => {
    setOpen(false);
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
        onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Dismiss">
          {/* Swallows taps so pressing the sheet itself doesn't close it. */}
          <Pressable onPress={() => {}}>
            <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.three }]}>
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
                Download the APK, open it and tap Update. It installs over this version and keeps
                all your data.
              </ThemedText>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => setOpen(false)}
                  style={({ pressed }) => [
                    styles.btn,
                    theme.glass,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button">
                  <ThemedText type="smallBold">Later</ThemedText>
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
                  <MaterialIcons name="download" size={18} color="#ffffff" />
                  <ThemedText type="smallBold" style={styles.downloadLabel}>
                    Download
                  </ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
  pressed: {
    opacity: 0.7,
  },
});
