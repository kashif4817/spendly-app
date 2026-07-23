import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GoogleGlyph } from '@/components/google-glyph';
import { PinPad } from '@/components/pin-pad';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLock } from '@/lock/provider';

const ACCENT = '#0B7C4F';
const DANGER = '#e5484d';

/** Full-screen unlock gate: biometric + PIN, with a "forgot PIN" Google fallback. */
export function LockScreen() {
  const { biometric, unlockWithPin, tryBiometric, forgotUnlock } = useLock();

  const [mode, setMode] = useState<'pin' | 'forgot'>('pin');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  const [busy, setBusy] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'pin' && biometric) tryBiometric();
  }, [mode, biometric, tryBiometric]);

  const onComplete = async (value: string) => {
    const ok = await unlockWithPin(value);
    if (ok) return;
    setError(true);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start(() => {
      setPin('');
      setError(false);
    });
  };

  const verifyWithGoogle = async () => {
    if (busy) return;
    setForgotError(null);
    setBusy(true);
    const ok = await forgotUnlock();
    setBusy(false);
    if (!ok) setForgotError('Couldn’t verify. Sign in with the same Google account (needs internet).');
    // On success the app unlocks and this screen unmounts.
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        {mode === 'pin' ? (
          <>
            <View style={styles.top}>
              <View style={styles.badge}>
                <ThemedText style={styles.badgeText}>Rs</ThemedText>
              </View>
              <ThemedText type="subtitle" style={styles.title}>
                Enter PIN
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Spendly is locked
              </ThemedText>
            </View>

            <Animated.View
              style={{
                transform: [
                  { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-12, 12] }) },
                ],
              }}>
              <PinPad
                value={pin}
                onChange={(v) => {
                  setError(false);
                  setPin(v);
                }}
                onComplete={onComplete}
                error={error}
                onBiometric={biometric ? tryBiometric : undefined}
              />
            </Animated.View>

            <Pressable onPress={() => setMode('forgot')} hitSlop={8} style={styles.link}>
              <ThemedText type="smallBold" style={{ color: ACCENT }}>
                Forgot PIN?
              </ThemedText>
            </Pressable>
          </>
        ) : (
          <View style={styles.forgot}>
            <View style={styles.top}>
              <ThemedText type="subtitle" style={styles.title}>
                Forgot PIN
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.forgotHint}>
                Verify with your Google account to turn off App Lock. It stays off
                until you set a new PIN.
              </ThemedText>
            </View>

            <Pressable
              onPress={verifyWithGoogle}
              disabled={busy}
              style={({ pressed }) => [styles.googleBtn, pressed && styles.pressed]}>
              {busy ? (
                <ActivityIndicator color="#3c4043" />
              ) : (
                <>
                  <GoogleGlyph size={20} />
                  <ThemedText style={styles.googleLabel}>Verify with Google</ThemedText>
                </>
              )}
            </Pressable>

            {forgotError && (
              <ThemedText type="small" style={styles.error}>
                {forgotError}
              </ThemedText>
            )}

            <Pressable onPress={() => setMode('pin')} hitSlop={8} style={styles.link}>
              <ThemedText type="small" themeColor="textSecondary">
                Back to PIN
              </ThemedText>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
    width: '100%',
  },
  top: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
  },
  link: {
    paddingVertical: Spacing.two,
  },
  forgot: {
    width: '100%',
    maxWidth: 380,
    gap: Spacing.four,
    alignItems: 'center',
  },
  forgotHint: {
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    minHeight: 54,
    borderWidth: 1,
    borderColor: '#dadce0',
    alignSelf: 'stretch',
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
    color: DANGER,
    textAlign: 'center',
  },
});
