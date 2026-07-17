import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { getDbInitError } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { useSync } from '@/sync/provider';

const ACCENT = '#208AEF';

function authMessage(code: string): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Wrong email or password.';
    case 'email_taken':
      return 'That email already has an account. Try logging in.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/**
 * Gates the whole app behind a one-time login. Once signed in, the session is
 * remembered, so this never shows again until the user signs out.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const { ready, email, signUp, logIn } = useSync();

  const [emailInput, setEmailInput] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'signup' | 'login' | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Still connecting / restoring the session.
  if (!ready) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color={ACCENT} />
      </ThemedView>
    );
  }

  const submit = async (action: 'signup' | 'login') => {
    if (busy) return;
    setError(null);
    setBusy(action);
    try {
      await (action === 'signup' ? signUp : logIn)(emailInput, password);
    } catch (e) {
      setError(authMessage(e instanceof Error ? e.message : 'server_error'));
    } finally {
      setBusy(null);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <ThemedText type="title" style={styles.title}>
            Spendly
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            Sign in once to keep your data backed up and in sync. It stays on your
            device and works offline.
          </ThemedText>

          <TextInput
            style={inputStyle}
            placeholder="Email"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            inputMode="email"
            value={emailInput}
            onChangeText={setEmailInput}
          />
          <TextInput
            style={inputStyle}
            placeholder="Password"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable
            onPress={() => submit('login')}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            accessibilityRole="button">
            {busy === 'login' ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText style={styles.primaryLabel}>Log in</ThemedText>
            )}
          </Pressable>

          <Pressable
            onPress={() => submit('signup')}
            style={styles.textBtn}
            accessibilityRole="button">
            {busy === 'signup' ? (
              <ActivityIndicator color={ACCENT} />
            ) : (
              <ThemedText type="small" style={{ color: ACCENT }}>
                New here? Create an account
              </ThemedText>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
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
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  title: {
    fontSize: 44,
    lineHeight: 50,
  },
  subtitle: {
    marginBottom: Spacing.three,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  error: {
    color: '#e5484d',
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
