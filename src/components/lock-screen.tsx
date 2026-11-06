import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BiometricTarget, type BiometricState } from '@/components/biometric-target';
import { GoogleGlyph } from '@/components/google-glyph';
import { useBiometrics } from '@/hooks/use-biometrics';
import { useTheme } from '@/hooks/use-theme';
import { PinPad } from '@/components/pin-pad';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useLock } from '@/lock/provider';

const DANGER = '#e5484d';

/** Full-screen unlock gate: biometric + PIN, with a "forgot PIN" Google fallback. */
export function LockScreen() {
  const theme = useTheme();
  const { biometric, unlockWithPin, tryBiometric, forgotUnlock } = useLock();

  const [mode, setMode] = useState<'pin' | 'forgot'>('pin');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  const [busy, setBusy] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const bio = useBiometrics();
  /** Offered only when the user turned it on AND the phone still has it. */
  const useBio = biometric && !!bio?.available;
  const [bioState, setBioState] = useState<BiometricState>('idle');

  /**
   * Ask the OS, and remember how it went.
   *
   * The result matters on screen, not just as an unlock: a face scan that
   * failed leaves the sheet gone and the PIN pad up, which without this looks
   * like the app never tried. The target turns red and says to tap again.
   */
  const askBiometric = useCallback(async () => {
    setBioState('scanning');
    const ok = await tryBiometric();
    // On success this screen is already unmounting; setting state would be a
    // no-op at best, so only the failure is recorded.
    if (!ok) setBioState('failed');
  }, [tryBiometric]);

  // Once, on arrival. Not on every render, and not again after it failed —
  // a prompt that reopens itself is a prompt you cannot get out of.
  const asked = useRef(false);
  useEffect(() => {
    if (mode !== 'pin' || !useBio || asked.current) return;
    asked.current = true;
    void askBiometric();
  }, [mode, useBio, askBiometric]);

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
              {useBio && bio ? (
                /* The sensor leads. The PIN is still right there underneath,
                   which is the whole reason a fallback exists. */
                <BiometricTarget
                  kind={bio.primary}
                  state={bioState}
                  label={
                    bio.primary === 'face'
                      ? 'Look at your phone'
                      : bio.primary === 'iris'
                        ? 'Look at your phone'
                        : 'Touch the sensor'
                  }
                  hint="or enter your PIN below"
                  onPress={askBiometric}
                />
              ) : (
                <>
                  <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                    <ThemedText style={styles.badgeText}>Rs</ThemedText>
                  </View>
                  <ThemedText type="subtitle" style={styles.title}>
                    Enter PIN
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Spendly is locked
                  </ThemedText>
                </>
              )}
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
                onBiometric={useBio ? askBiometric : undefined}
                biometricKind={bio?.primary}
              />
            </Animated.View>

            <Pressable onPress={() => setMode('forgot')} hitSlop={8} style={styles.link}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
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
    borderRadius: Radius.card,
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
    borderRadius: Radius.medium,
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
