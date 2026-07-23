import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthScreen } from '@/components/auth-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getDbInitError } from '@/db';
import { useSync } from '@/sync/provider';

const ACCENT = '#0B7C4F';

/**
 * Gates the whole app behind a one-time login. Once signed in, the session is
 * remembered, so this never shows again until the user signs out. All the
 * actual login/sign-up UI lives in <AuthScreen>.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, email } = useSync();

  // A fatal DB error — show it instead of a blank/stuck screen so it's reportable.
  const initError = getDbInitError();
  if (initError) {
    return (
      <ThemedView style={styles.center}>
        <View style={styles.errorBox}>
          <ThemedText type="smallBold" style={styles.errorTitle}>
            Couldn’t start the database
          </ThemedText>
          <ThemedText type="small" style={styles.errorText}>
            {initError}
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  // Signed in (or session restored) → show the app.
  if (email) return <>{children}</>;

  // Still restoring the session.
  if (!ready) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={ACCENT} />
      </ThemedView>
    );
  }

  return <AuthScreen />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
    alignItems: 'center',
  },
  errorTitle: {
    color: '#e5484d',
  },
  errorText: {
    textAlign: 'center',
  },
});
