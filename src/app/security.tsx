import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmModal } from '@/components/confirm-modal';
import { PinPad } from '@/components/pin-pad';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  biometricAvailable,
  disableLock,
  PIN_LENGTH,
  setBiometricEnabled,
  setPin,
} from '@/lock/app-lock';
import { useLock } from '@/lock/provider';

const ACCENT = '#0B7C4F';
const DANGER = '#e5484d';

type Step = 'idle' | 'create' | 'confirm';

export default function SecurityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { enabled, biometric, refresh } = useLock();

  const [step, setStep] = useState<Step>('idle');
  const [pin, setPinValue] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    biometricAvailable().then(setBioAvailable);
  }, []);

  const startCreate = () => {
    setError(null);
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
    await refresh();
    setStep('idle');
    setPinValue('');
  };

  const toggleBiometric = async (on: boolean) => {
    await setBiometricEnabled(on);
    await refresh();
  };

  const turnOff = async () => {
    setConfirmOff(false);
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
            {step === 'create'
              ? `Choose a ${PIN_LENGTH}-digit PIN to lock the app.`
              : 'Enter it once more to confirm.'}
          </ThemedText>

          <PinPad value={pin} onChange={setPinValue} onComplete={onPinComplete} />

          {error && (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          )}

          <Pressable onPress={() => setStep('idle')} style={styles.cancel} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: ACCENT }}>
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
            Lock Spendly with a PIN{bioAvailable ? ' or your fingerprint / Face ID' : ''}. You’ll
            unlock it when you open the app after leaving it.
          </ThemedText>

          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.row}>
              <ThemedText type="smallBold">App Lock</ThemedText>
              <ThemedText type="small" style={{ color: enabled ? ACCENT : theme.textSecondary }}>
                {enabled ? 'On' : 'Off'}
              </ThemedText>
            </View>

            {enabled && bioAvailable && (
              <View style={styles.row}>
                <ThemedText type="small">Use fingerprint / Face ID</ThemedText>
                <Switch
                  value={biometric}
                  onValueChange={toggleBiometric}
                  trackColor={{ true: ACCENT }}
                />
              </View>
            )}
          </View>

          {!enabled ? (
            <Pressable
              onPress={startCreate}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
              <ThemedText style={styles.primaryLabel}>Turn on App Lock</ThemedText>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={startCreate}
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
                <ThemedText style={styles.primaryLabel}>Change PIN</ThemedText>
              </Pressable>
              <Pressable onPress={() => setConfirmOff(true)} style={styles.textBtn} hitSlop={8}>
                <ThemedText type="smallBold" style={{ color: DANGER }}>
                  Turn off App Lock
                </ThemedText>
              </Pressable>
            </>
          )}

          <Pressable onPress={() => router.back()} style={styles.textBtn} hitSlop={8}>
            <ThemedText type="small" themeColor="textSecondary">
              Done
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>

      <ConfirmModal
        visible={confirmOff}
        title="Turn off App Lock?"
        message="Anyone who opens the app will be able to see your money. You can turn it back on anytime."
        confirmLabel="Turn off"
        destructive
        onCancel={() => setConfirmOff(false)}
        onConfirm={turnOff}
      />
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
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  primaryBtn: {
    backgroundColor: ACCENT,
    borderRadius: 12,
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
