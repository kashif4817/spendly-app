import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSync } from '@/sync/provider';

const ACCENT = '#208AEF';

export default function BackupScreen() {
  const { email, status, lastSyncedAt, syncNow, logOut } = useSync();

  const statusLabel =
    status === 'syncing'
      ? 'Syncing…'
      : status === 'offline'
        ? 'Offline — will sync later'
        : 'Backed up';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.content}>
          <ThemedText type="title" style={styles.title}>
            Backup
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Your data is on this device and backed up to the cloud. It works
            offline and syncs automatically.
          </ThemedText>

          <View style={styles.card}>
            <ThemedText type="smallBold">Signed in</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {email}
            </ThemedText>

            <View style={styles.statusRow}>
              <View style={[styles.dot, status === 'offline' && styles.dotOffline]} />
              <ThemedText type="small">{statusLabel}</ThemedText>
            </View>
            {lastSyncedAt && (
              <ThemedText type="small" themeColor="textSecondary">
                Last synced {lastSyncedAt.toLocaleTimeString()}
              </ThemedText>
            )}

            <Pressable
              onPress={syncNow}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              accessibilityRole="button">
              <ThemedText style={styles.primaryLabel}>Sync now</ThemedText>
            </Pressable>
            <Pressable onPress={logOut} style={styles.textBtn} accessibilityRole="button">
              <ThemedText type="small" style={{ color: ACCENT }}>
                Sign out
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.one,
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
  },
  card: {
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: '#1a9c5b',
  },
  dotOffline: {
    backgroundColor: '#e5a23d',
  },
  primaryBtn: {
    marginTop: Spacing.two,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primaryLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
  textBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    minHeight: 36,
    justifyContent: 'center',
  },
});
