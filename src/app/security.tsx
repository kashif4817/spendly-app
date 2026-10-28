import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassDivider } from '@/components/glass';
import { PinPad } from '@/components/pin-pad';
import { confirm } from '@/lib/confirm';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  biometricAvailable,
  disableBalancePin,
  disableLock,
  PIN_LENGTH,
  setAppLockEnabled,
  setBalancePinRequired,
  setBiometricEnabled,
  setPin,
} from '@/lock/app-lock';
import { useLock } from '@/lock/provider';

const DANGER = '#e5484d';

type Step = 'idle' | 'create' | 'confirm';

/**
 * What the PIN being typed is FOR. There is one PIN in the app and two things
 * that can ask for it, so the pad has to know which switch to flip once the
 * digits check out — and 'change' flips neither.
 */
type Intent = 'lock' | 'balance' | 'change';

export default function SecurityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { hasPin, enabled, biometric, balancePin, refresh } = useLock();

  const [step, setStep] = useState<Step>('idle');
  const [intent, setIntent] = useState<Intent>('lock');
  const [pin, setPinValue] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    biometricAvailable().then(setBioAvailable);
  }, []);

  /** Apply what the PIN was for. Split out because an existing PIN skips the pad. */
  const applyIntent = async (which: Intent) => {
    if (which === 'lock') await setAppLockEnabled(true);
    else if (which === 'balance') await setBalancePinRequired(true);
    await refresh();
  };

  const start = async (which: Intent) => {
    // Already have a PIN? The second switch doesn't need it typed again — it is
    // the same secret, and asking twice would imply it wasn't.
    if (hasPin && which !== 'change') {
      await applyIntent(which);
      return;
    }
    setError(null);
    setIntent(which);
    setFirstPin('');
    setPinValue('');
    setStep('create');
  };

  const onPinComplete = async (value: string) => {
    if (step === 'create') {
      setFirstPin(value);
      setPinValue('');
      setStep('confirm');
      return;
    }
    // confirm
    if (value !== firstPin) {
      setError('PINs didn’t match. Try again.');
      setFirstPin('');
      setPinValue('');
      setStep('create');
      return;
    }
    await setPin(value);
    await applyIntent(intent);
    setStep('idle');
    setPinValue('');
  };

  const toggleBiometric = async (on: boolean) => {
    await setBiometricEnabled(on);
    await refresh();
  };

  const toggleBalancePin = async (on: boolean) => {
    if (on) {
      await start('balance');
      return;
    }
    await disableBalancePin();
    await refresh();
  };

  const turnOff = async () => {
    await disableLock();
    await refresh();
    setStep('idle');
  };

  if (step !== 'idle') {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeCenter}>
          <ThemedText type="subtitle" style={styles.title}>
            {step === 'create' ? 'Create a PIN' : 'Confirm your PIN'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            {step === 'confirm'
              ? 'Enter it once more to confirm.'
              : intent === 'balance'
                ? `Choose a ${PIN_LENGTH}-digit PIN. The same one unlocks the app if you turn App Lock on.`
                : `Choose a ${PIN_LENGTH}-digit PIN to lock the app.`}
          </ThemedText>

          <PinPad value={pin} onChange={setPinValue} onComplete={onPinComplete} />

          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable onPress={() => setStep('idle')} style={styles.cancel} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              Cancel
            </ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <ThemedText type="small" themeColor="textSecondary">
            One PIN{bioAvailable ? ', or your fingerprint / Face ID' : ''} — it can lock the app, guard
            the balances you&apos;ve hidden, or both. Hide a balance from a person or a shared
            book&apos;s own screen.
          </ThemedText>

          <View style={[styles.card, theme.glass]}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText type="smallBold">App Lock</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Unlock when you open the app after leaving it
                </ThemedText>
              </View>
              <ThemedText type="small" style={{ color: enabled ? theme.accent : theme.textSecondary }}>
                {enabled ? 'On' : 'Off'}
              </ThemedText>
            </View>

            <GlassDivider />

            {/* The second thing allowed to ask for the PIN. It stands alone:
                plenty of people want a balance covered in public without a gate
                on the whole app every time they open it. Which balances are
                hidden is chosen per person or book, on their own statement. */}
            <View style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText type="smallBold">Require PIN to see balances</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {balancePin
                    ? 'A hidden balance needs your PIN, and covers itself again'
                    : 'A hidden balance shows on a tap, with no PIN'}
                </ThemedText>
              </View>
              <Switch
                value={balancePin}
                onValueChange={toggleBalancePin}
                trackColor={{ true: theme.accent }}
              />
            </View>

            {/* Offered as soon as a PIN exists, because biometrics now stand in
                for it on the balance prompt as well as on the lock screen. */}
            {hasPin && bioAvailable && (
              <>
                <GlassDivider />
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <ThemedText type="smallBold">Use fingerprint / Face ID</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Instead of typing the PIN
                    </ThemedText>
                  </View>
                  <Switch
                    value={biometric}
                    onValueChange={toggleBiometric}
                    trackColor={{ true: theme.accent }}
                  />
                </View>
              </>
            )}
          </View>

          {!enabled ? (
            <Pressable
              onPress={() => start('lock')}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: theme.accent },
                pressed && styles.pressed,
              ]}>
              <ThemedText style={styles.primaryLabel}>Turn on App Lock</ThemedText>
            </Pressable>
          ) : (
            <Pressable
              onPress={() =>
                confirm({
                  title: 'Turn off App Lock?',
                  message: balancePin
                    ? 'The app will open without a PIN. Your balances stay covered, and your PIN is kept for those.'
                    : 'Anyone who opens the app will be able to see your money. You can turn it back on anytime.',
                  confirmLabel: 'Turn off',
                  destructive: true,
                  onConfirm: turnOff,
                })
              }
              style={styles.textBtn}
              hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: DANGER }}>
                Turn off App Lock
              </ThemedText>
            </Pressable>
          )}

          {hasPin && (
            <Pressable onPress={() => start('change')} style={styles.textBtn} hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Change PIN
              </ThemedText>
            </Pressable>
          )}

          <Pressable onPress={() => router.back()} style={styles.textBtn} hitSlop={8}>
            <ThemedText type="small" themeColor="textSecondary">
              Done
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  safeCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  card: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  /** Lets a two-line label wrap instead of shoving the switch off the row. */
  rowText: {
    flex: 1,
    gap: 1,
  },
  primaryBtn: {
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: { opacity: 0.85 },
  textBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    minHeight: 36,
    justifyContent: 'center',
  },
  cancel: {
    paddingVertical: Spacing.two,
  },
  error: {
    color: DANGER,
  },
});
