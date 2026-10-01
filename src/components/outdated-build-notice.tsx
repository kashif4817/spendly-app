import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Runtimes of builds that can no longer be kept up to date over the air.
 *
 * Builds before 1.1.0 were pinned to a fixed runtime hash. One last OTA update
 * was published to that runtime carrying this screen, so those phones are told
 * to install the new APK instead of quietly running old code forever.
 */
const RETIRED_RUNTIMES = ['ee3409d627dcde7839cb6d8eb2b11c176c9e7549'];

export function isRetiredBuild(): boolean {
  try {
    return Updates.isEnabled && RETIRED_RUNTIMES.includes(Updates.runtimeVersion ?? '');
  } catch {
    return false;
  }
}

const release = Constants.expoConfig?.extra?.release as { repo?: string; apk?: string } | undefined;
const DOWNLOAD_URL = `https://github.com/${release?.repo ?? 'kashif4817/spendly-app'}/releases/latest/download/${release?.apk ?? 'Spendly.apk'}`;

/** Full-screen "please install the new version" — the only thing a retired build shows. */
export function OutdatedBuildNotice() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <ThemedView
      style={[styles.container, { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.four }]}>
      <View style={styles.body}>
        <BrandMark style={styles.logo} />
        <ThemedText type="subtitle" style={styles.title}>
          This version is outdated
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.text}>
          A new version of Spendly is ready. Download it, open the file and tap Update. It
          installs over this one and keeps all your data. Don’t uninstall first.
        </ThemedText>
      </View>

      <Pressable
        onPress={() => Linking.openURL(DOWNLOAD_URL).catch(() => {})}
        style={({ pressed }) => [styles.button, { backgroundColor: theme.accent }, pressed && styles.pressed]}
        accessibilityRole="button">
        <MaterialIcons name="download" size={20} color="#ffffff" />
        <ThemedText style={styles.buttonLabel}>Download the new version</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  logo: {
    width: 96,
    height: 96,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    textAlign: 'center',
  },
  text: {
    textAlign: 'center',
    maxWidth: 360,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    minHeight: 54,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.8,
  },
});
