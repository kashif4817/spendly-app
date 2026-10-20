/**
 * What is running, and whether anything newer is waiting.
 *
 * TWO version numbers matter here and they are not the same thing:
 *
 *   • the BUILD — the installed APK, carried by the pill under the mark.
 *     Only a new APK changes it, and it is what `runtimeVersion` is keyed to,
 *     so an over-the-air update can only ever reach builds carrying the same
 *     one.
 *   • the UPDATE — the JavaScript bundle on top of that build. `eas update`
 *     changes this without touching the APK, which is how most changes
 *     arrive. `Updates.createdAt` is when the running bundle was published.
 *
 * Showing only one of them is what makes "did my update land?" unanswerable,
 * so the mark carries the build and the card below carries the update.
 *
 * The bundle's id is deliberately NOT shown. It identifies a build to a
 * developer, reads as a line of noise to everyone else, and the timestamp
 * beside it already answers the only question this page is opened with.
 *
 * The page is a hero and one card, not four stacked sections: when the last
 * update landed and whether a newer one exists are the same errand, so they
 * belong on one surface with the button at the foot of it. Sharing the app
 * used to live here too — it is its own row in Settings now, because passing
 * Spendly on has nothing to do with checking what you are running.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { GlassDivider } from '@/components/glass';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/confirm';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

const APP_VERSION = Constants.expoConfig?.version ?? '—';

/** "10 Oct 2026, 3:39 am" — when the running JS bundle was published. */
function formatStamp(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type CheckState = 'idle' | 'checking' | 'downloading' | 'ready' | 'current';

export default function SettingsAboutScreen() {
  const theme = useTheme();
  const [state, setState] = useState<CheckState>('idle');

  // Running the bundle that shipped inside the APK means no update has been
  // applied yet — not that something is wrong.
  const embedded = (() => {
    try {
      return Updates.isEmbeddedLaunch;
    } catch {
      return true;
    }
  })();

  const updateStamp = (() => {
    try {
      return formatStamp(Updates.createdAt);
    } catch {
      return '—';
    }
  })();

  const check = async () => {
    if (state === 'checking' || state === 'downloading') return;
    if (!Updates.isEnabled) {
      notify(
        'Updates are off in this build',
        'Over-the-air updates only run in a release build, not in Expo Go or a dev client.'
      );
      return;
    }

    setState('checking');
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setState('current');
        return;
      }

      setState('downloading');
      await Updates.fetchUpdateAsync();
      setState('ready');
      confirm({
        title: 'Update ready',
        message: 'Spendly needs to restart to apply it. Nothing you have entered will be lost.',
        confirmLabel: 'Restart now',
        cancelLabel: 'Later',
        onConfirm: () => {
          Updates.reloadAsync().catch(() => {
            notify('Couldn’t restart', 'Close Spendly and open it again to finish updating.');
          });
        },
      });
    } catch {
      setState('idle');
      notify('Couldn’t check for updates', 'Check your connection and try again.');
    }
  };

  const busy = state === 'checking' || state === 'downloading';

  const buttonLabel =
    state === 'checking'
      ? 'Checking…'
      : state === 'downloading'
        ? 'Downloading…'
        : state === 'ready'
          ? 'Restart to apply'
          : 'Check for updates';

  // The headline inside the card: the result of the last check, said once, on
  // the screen — where before it only ever appeared in a dialog you dismissed.
  const status: { icon: IconName; title: string; hint: string } =
    state === 'current'
      ? {
          icon: 'check-circle',
          title: 'You’re on the latest version',
          hint: 'Nothing newer has been published yet.',
        }
      : state === 'ready'
        ? {
            icon: 'download-done',
            title: 'Update downloaded',
            hint: 'Restart Spendly to finish applying it.',
          }
        : busy
          ? {
              icon: 'cloud-sync',
              title: state === 'downloading' ? 'Downloading the update' : 'Looking for an update',
              hint: 'This only takes a moment.',
            }
          : {
              icon: 'cloud-download',
              title: 'Check for a new version',
              hint: 'Most changes arrive over the air and only need a restart.',
            };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'About' }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* The mark, the name, and the one number most people mean when
              they ask what version they are on. */}
          <ThemedView type="backgroundElement" style={styles.hero}>
            <BrandMark style={styles.heroLogo} />
            <ThemedText type="smallBold" style={styles.heroName}>
              Spendly
            </ThemedText>
            <View style={[styles.versionPill, theme.glassWeak]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Version {APP_VERSION}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.heroBy}>
              Made by Kashif Mehmood
            </ThemedText>
          </ThemedView>

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            UPDATES
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            {/* When the running code was published: the time on its own, with
                no bundle id beside it. */}
            <View style={styles.detail}>
              <View style={[styles.detailIcon, theme.glassWeak]}>
                <MaterialIcons name="schedule" size={19} color={theme.accentTint} />
              </View>
              <View style={styles.detailText}>
                <ThemedText type="smallBold">Last update</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  {embedded
                    ? 'Running the version that shipped with the app'
                    : 'Delivered over the air'}
                </ThemedText>
              </View>
              <ThemedText type="smallBold" numberOfLines={2} style={styles.detailValue}>
                {embedded ? 'None yet' : updateStamp}
              </ThemedText>
            </View>

            <GlassDivider />

            <View style={styles.status}>
              <MaterialIcons name={status.icon} size={21} color={theme.accentTint} />
              <View style={styles.statusText}>
                <ThemedText type="smallBold">{status.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {status.hint}
                </ThemedText>
              </View>
            </View>

            <Pressable
              onPress={check}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={buttonLabel}
              accessibilityState={{ disabled: busy, busy }}
              style={({ pressed }) => [
                styles.checkBtn,
                { backgroundColor: theme.accent },
                busy && styles.disabled,
                pressed && styles.pressed,
              ]}>
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <MaterialIcons name="system-update" size={19} color="#ffffff" />
              )}
              <ThemedText style={styles.checkLabel}>{buttonLabel}</ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            The version above changes only when you install a new app file. Everything else
            arrives over the air.
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
  hero: {
    alignItems: 'center',
    borderRadius: Radius.large,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
  },
  heroLogo: {
    width: 54,
    height: 54,
    marginBottom: Spacing.two,
  },
  heroName: {
    fontSize: 19,
  },
  versionPill: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    marginTop: Spacing.one,
  },
  heroBy: {
    marginTop: Spacing.one,
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
    paddingBottom: Spacing.three,
  },
  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 62,
    paddingVertical: Spacing.two,
  },
  detailIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailText: {
    flex: 1,
    gap: 1,
  },
  detailValue: {
    flexShrink: 1,
    textAlign: 'right',
    maxWidth: '42%',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three - 2,
    paddingVertical: Spacing.three,
  },
  statusText: {
    flex: 1,
    gap: 1,
  },
  checkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 52,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
    boxShadow: [
      { offsetX: 0, offsetY: 8, blurRadius: 22, color: 'rgba(0,0,0,0.28)' },
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: 'rgba(255,255,255,0.45)', inset: true },
    ],
  },
  checkLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  footnote: {
    marginTop: Spacing.three,
    marginLeft: Spacing.half,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.6,
  },
});
