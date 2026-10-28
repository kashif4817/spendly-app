/**
 * The PIN ask that stands between a covered balance and the figure itself.
 *
 * Mounted once at the root, the same shape as <ConfirmHost>: anything that
 * wants a balance shown calls `askForBalancePin` and this renders the ask. It
 * is a dialog rather than a screen on purpose — you are proving who you are to
 * uncover one number, not leaving where you were.
 *
 * It is the SAME PIN as App Lock. There is one secret in the app; this is the
 * second thing allowed to ask for it.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native';

import { PinPad } from '@/components/pin-pad';
import { ThemedText } from '@/components/themed-text';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import { useBalancePinRequest } from '@/hooks/use-balance-privacy';
import { useTheme } from '@/hooks/use-theme';
import { dismissBalancePin } from '@/lib/balance-privacy';
import { promptBiometric, verifyPin } from '@/lock/app-lock';
import { useLock } from '@/lock/provider';

export function BalancePinHost() {
  const request = useBalancePinRequest();
  // Remounted per ask, so the pad never opens holding the last attempt.
  if (!request) return null;
  return <BalancePinDialog onUnlock={request.onUnlock} />;
}

function BalancePinDialog({ onUnlock }: { onUnlock: () => void }) {
  const theme = useTheme();
  const { biometric } = useLock();

  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  const succeed = () => {
    dismissBalancePin();
    onUnlock();
  };

  useEffect(() => {
    if (!biometric) return;
    // Offer the face/finger first — it's the same proof and one less step.
    promptBiometric('Show your balance').then((ok) => {
      if (ok) succeed();
    });
    // Once per ask: this dialog is remounted for each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onComplete = async (value: string) => {
    if (await verifyPin(value)) {
      succeed();
      return;
    }
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

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismissBalancePin}>
      <Pressable style={styles.backdrop} onPress={dismissBalancePin} accessibilityLabel="Dismiss">
        {/* Swallows taps so pressing the pad doesn't dismiss it. */}
        <Pressable onPress={() => {}} style={styles.cardWrap}>
          <View style={[styles.card, theme.glassOverlay]}>
            <View style={[styles.badge, { backgroundColor: theme.accent }]}>
              <ThemedText style={styles.badgeText}>Rs</ThemedText>
            </View>

            <ThemedText type="smallBold" style={styles.title}>
              Enter your PIN
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
              {error ? 'That PIN didn’t match. Try again.' : 'This balance is hidden.'}
            </ThemedText>

            <Animated.View
              style={[
                styles.pad,
                {
                  transform: [
                    { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-12, 12] }) },
                  ],
                },
              ]}>
              <PinPad
                value={pin}
                onChange={(v) => {
                  setError(false);
                  setPin(v);
                }}
                onComplete={onComplete}
                error={error}
                onBiometric={
                  biometric
                    ? () => promptBiometric('Show your balance').then((ok) => ok && succeed())
                    : undefined
                }
              />
            </Animated.View>

            <Pressable onPress={dismissBalancePin} style={styles.cancel} hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Not now
              </ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Scrim,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 360,
  },
  card: {
    borderRadius: Radius.large,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
    gap: Spacing.one,
    alignItems: 'center',
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '800',
  },
  title: {
    fontSize: 19,
    lineHeight: 26,
  },
  message: {
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  pad: {
    alignItems: 'center',
  },
  cancel: {
    paddingVertical: Spacing.three,
  },
});
