import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';

/** Clears the floating AddButton so the two never overlap. */
const FabClearance = 52;

/**
 * Floating banner offering an over-the-air update once one has downloaded.
 *
 * Deliberately never reloads on its own: a restart mid-entry would throw away
 * whatever the user was typing. If the banner is ignored or dismissed, the
 * downloaded update applies on the next cold start anyway.
 */
export function UpdatePrompt() {
  const { isDownloading, isUpdatePending } = Updates.useUpdates();
  const [dismissed, setDismissed] = useState(false);
  const checking = useRef(false);

  useEffect(() => {
    // Updates are stripped from Expo Go and dev builds, where these calls throw
    // rather than no-op.
    if (__DEV__ || !Updates.isEnabled) return;

    const check = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // Offline or misconfigured — stay hidden and retry on next foreground.
      } finally {
        checking.current = false;
      }
    };

    check();
    // A launch-only check would rarely fire for anyone who leaves the app open
    // for days, so re-check whenever it comes back to the foreground.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, []);

  if (dismissed || (!isDownloading && !isUpdatePending)) return null;

  return (
    <View style={styles.banner}>
      <View style={styles.left}>
        <MaterialIcons name="system-update" size={20} color="#ffffff" />
        <View style={styles.copy}>
          <ThemedText style={styles.title}>
            {isUpdatePending ? 'Update ready' : 'Downloading update…'}
          </ThemedText>
          <ThemedText style={styles.subtitle}>
            {isUpdatePending ? 'Restart to apply the latest changes' : 'Please wait a moment'}
          </ThemedText>
        </View>
      </View>

      <View style={styles.actions}>
        {isUpdatePending ? (
          <>
            <Pressable
              onPress={() => Updates.reloadAsync()}
              style={({ pressed }) => [styles.restart, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Restart to apply update">
              <ThemedText style={styles.restartLabel}>Restart</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setDismissed(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Dismiss update banner">
              <MaterialIcons name="close" size={18} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </>
        ) : (
          <ActivityIndicator size="small" color="#ffffff" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: BottomTabInset + Spacing.three + FabClearance,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 14,
    backgroundColor: '#208AEF',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
  },
  copy: {
    flex: 1,
  },
  title: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  restart: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  pressed: {
    opacity: 0.85,
  },
  restartLabel: {
    color: '#208AEF',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
});
