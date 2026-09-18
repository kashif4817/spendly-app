import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoogleGlyph } from '@/components/google-glyph';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { GOOGLE_CANCELLED } from '@/lib/google';
import { useSync } from '@/sync/provider';

const LOGO = require('../../assets/images/spendly-logo.png');
const MAX_WIDTH = 420;
/** The signed-out screen: brand + a single "Continue with Google" button. */
export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { signInWithGoogle } = useSync();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGoogle = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      // TEMP: show the real error so we can diagnose setup. Revert to a friendly
      // message once "Continue with Google" works end to end.
      if (msg !== GOOGLE_CANCELLED) {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.five },
        ]}>
        <View style={styles.card}>
          {/* Brand */}
          <View style={styles.brand}>
            <Image source={LOGO} style={styles.logo} contentFit="contain" />
            <ThemedText type="title" style={styles.wordmark}>
              Spendly
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.tagline}>
              Track spending, settle up with people, and back it all up.
            </ThemedText>
          </View>

          {/* Feature bullets */}
          <View style={styles.features}>
            <Feature text="Expenses & income at a glance" />
            <Feature text="Lend & borrow — know who owes what" />
            <Feature text="Synced & backed up on every device" />
          </View>

          {/* Sign in */}
          <View style={styles.actions}>
            <Pressable
              onPress={onGoogle}
              disabled={busy}
              style={({ pressed }) => [styles.googleBtn, pressed && styles.pressed]}
              accessibilityRole="button">
              {busy ? (
                <ActivityIndicator color="#3c4043" />
              ) : (
                <>
                  <GoogleGlyph size={20} />
                  <ThemedText style={styles.googleLabel}>Continue with Google</ThemedText>
                </>
              )}
            </Pressable>

            {error && (
              <ThemedText type="small" style={styles.error}>
                {error}
              </ThemedText>
            )}

            <ThemedText type="small" themeColor="textSecondary" style={styles.legal}>
              By continuing, you agree to our Terms & Privacy Policy.
            </ThemedText>
          </View>
        </View>

        <ThemedText type="small" style={[styles.footerBrand, { color: theme.textSecondary }]}>
          Made for everyday money
        </ThemedText>
      </View>
    </ThemedView>
  );
}

function Feature({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.feature}>
      <View style={[styles.dot, { backgroundColor: theme.accent }]} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.featureText}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
  },
  card: {
    flex: 1,
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignSelf: 'center',
    justifyContent: 'center',
    gap: Spacing.six,
  },
  brand: {
    alignItems: 'center',
  },
  logo: {
    width: 96,
    height: 96,
    marginBottom: Spacing.three,
  },
  wordmark: {
    fontSize: 40,
    lineHeight: 46,
  },
  tagline: {
    textAlign: 'center',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    lineHeight: 20,
  },
  features: {
    gap: Spacing.three,
    alignSelf: 'center',
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  featureText: {
    fontSize: 14,
  },
  actions: {
    gap: Spacing.three,
    alignItems: 'center',
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: Spacing.three,
    minHeight: 56,
    width: '100%',
    borderWidth: 1,
    borderColor: '#dadce0',
    // subtle lift
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  googleLabel: {
    color: '#3c4043',
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.9,
  },
  error: {
    color: '#e5484d',
    textAlign: 'center',
  },
  legal: {
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  footerBrand: {
    opacity: 0.5,
    fontSize: 12,
  },
});
