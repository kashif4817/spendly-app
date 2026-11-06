/**
 * App-lock storage + crypto. The PIN is never stored in the clear — only a
 * salted SHA-256 hash, kept in the OS secure store (Keychain / Keystore).
 * Biometric unlock is delegated to expo-local-authentication.
 *
 * THERE IS ONE PIN, AND TWO THINGS CAN ASK FOR IT:
 *
 *   enabled    — App Lock: the whole app is gated on a cold start and after
 *                it has been in the background a while.
 *   balancePin — Hidden balances: revealing a balance asks for the PIN.
 *
 * They are independent switches over the same secret, which is why "has a PIN"
 * (`hasPin`) is tracked separately from "App Lock is on" (`enabled`). Turning
 * App Lock off used to delete the PIN outright; it can't any more, because the
 * balance switch may still be relying on it. `forgetPinIfUnused` is the one
 * place that decides the secret is genuinely orphaned.
 */

import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const PIN_KEY = 'spendly_lock_pin_hash';
const SALT_KEY = 'spendly_lock_salt';
const ENABLED_KEY = 'spendly_lock_enabled';
const BIOMETRIC_KEY = 'spendly_lock_biometric';
const BALANCE_KEY = 'spendly_lock_balance';

export const PIN_LENGTH = 4;

export type LockConfig = {
  /** A PIN has been set. Either switch below can be turned on. */
  hasPin: boolean;
  /** App lock is on: the app itself is gated. */
  enabled: boolean;
  /** Biometric unlock is preferred when available. */
  biometric: boolean;
  /** Showing a hidden balance asks for the PIN. */
  balancePin: boolean;
};

export async function getLockConfig(): Promise<LockConfig> {
  const [pin, enabled, biometric, balance] = await Promise.all([
    SecureStore.getItemAsync(PIN_KEY),
    SecureStore.getItemAsync(ENABLED_KEY),
    SecureStore.getItemAsync(BIOMETRIC_KEY),
    SecureStore.getItemAsync(BALANCE_KEY),
  ]);
  return {
    hasPin: !!pin,
    enabled: enabled === '1',
    biometric: biometric === '1',
    balancePin: balance === '1',
  };
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

/**
 * Set (or change) the PIN. It turns nothing on by itself — the caller decides
 * whether it's for App Lock, for balances, or for both.
 */
export async function setPin(pin: string): Promise<void> {
  let salt = await SecureStore.getItemAsync(SALT_KEY);
  if (!salt) {
    salt = Crypto.randomUUID();
    await SecureStore.setItemAsync(SALT_KEY, salt);
  }
  await SecureStore.setItemAsync(PIN_KEY, await hashPin(pin, salt));
}

export async function verifyPin(pin: string): Promise<boolean> {
  const [salt, stored] = await Promise.all([
    SecureStore.getItemAsync(SALT_KEY),
    SecureStore.getItemAsync(PIN_KEY),
  ]);
  if (!salt || !stored) return false;
  return (await hashPin(pin, salt)) === stored;
}

/** Gate the whole app behind the PIN, or stop doing so. */
export async function setAppLockEnabled(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(ENABLED_KEY, on ? '1' : '0');
}

/** Ask for the PIN before a hidden balance is shown, or stop doing so. */
export async function setBalancePinRequired(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(BALANCE_KEY, on ? '1' : '0');
}

export async function setBiometricEnabled(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_KEY, on ? '1' : '0');
}

/**
 * Drop the stored PIN once nothing is asking for it any more.
 *
 * Keeping a hash nobody can reach would be harmless but untidy; deleting one
 * the balance switch still needs would silently break that switch. So the
 * check is on the stored flags, not on whatever the caller happens to know.
 */
async function forgetPinIfUnused(): Promise<void> {
  const [enabled, balance] = await Promise.all([
    SecureStore.getItemAsync(ENABLED_KEY),
    SecureStore.getItemAsync(BALANCE_KEY),
  ]);
  if (enabled === '1' || balance === '1') return;
  await Promise.all([
    SecureStore.deleteItemAsync(PIN_KEY),
    SecureStore.deleteItemAsync(SALT_KEY),
    SecureStore.deleteItemAsync(BIOMETRIC_KEY),
  ]);
}

/** Turn App Lock off, forgetting the PIN if balances weren't using it too. */
export async function disableLock(): Promise<void> {
  await setAppLockEnabled(false);
  await forgetPinIfUnused();
}

/** Stop asking for the PIN on balances, forgetting it if App Lock is off too. */
export async function disableBalancePin(): Promise<void> {
  await setBalancePinRequired(false);
  await forgetPinIfUnused();
}

/**
 * Forget the PIN and everything it guarded — the forgot-PIN recovery path.
 * Both switches go off, because a switch pointing at a secret that no longer
 * exists would lock the user out of their own balances.
 */
export async function forgetPin(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(PIN_KEY),
    SecureStore.deleteItemAsync(SALT_KEY),
    SecureStore.deleteItemAsync(ENABLED_KEY),
    SecureStore.deleteItemAsync(BIOMETRIC_KEY),
    SecureStore.deleteItemAsync(BALANCE_KEY),
  ]);
}

/** Which sensor the phone actually has, so the app can name it properly. */
export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none';

export type BiometricInfo = {
  /** Hardware exists AND the user has enrolled something. The only flag the UI should gate on. */
  available: boolean;
  /** There is a sensor, whether or not anything is enrolled. */
  hasHardware: boolean;
  /** Something is enrolled in the OS — the app never enrols anything itself. */
  enrolled: boolean;
  face: boolean;
  fingerprint: boolean;
  iris: boolean;
  /** What to draw and what to lead with. */
  primary: BiometricKind;
  /** What to call it on screen: "Face Unlock", "Fingerprint", "Face or fingerprint". */
  label: string;
  /**
   * How strong the enrolled method is.
   *
   * BIOMETRIC_WEAK is a 2D camera face unlock — the kind that can be fooled
   * by a photograph on some phones. Worth knowing about for something that
   * guards money, which is why it is surfaced rather than hidden.
   */
  level: LocalAuthentication.SecurityLevel;
};

const NO_BIOMETRICS: BiometricInfo = {
  available: false,
  hasHardware: false,
  enrolled: false,
  face: false,
  fingerprint: false,
  iris: false,
  primary: 'none',
  label: 'Biometrics',
  level: LocalAuthentication.SecurityLevel.NONE,
};

/**
 * What this device can unlock with.
 *
 * NOTHING IS ENROLLED HERE. `isEnrolledAsync` asks whether the USER has
 * already set up a fingerprint or face in the system settings; the app simply
 * borrows it, the same way a banking app does. Spendly never sees a
 * fingerprint, never stores one, and has nothing to manage if one is removed.
 */
export async function getBiometricInfo(): Promise<BiometricInfo> {
  try {
    const [hasHardware, enrolled, types, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
    ]);

    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const fingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const iris = types.includes(LocalAuthentication.AuthenticationType.IRIS);

    // Face leads when the phone has it, because a face target is the one that
    // needs explaining on screen — a fingerprint reader is somewhere you
    // already know to put your thumb.
    const primary: BiometricKind = face
      ? 'face'
      : fingerprint
        ? 'fingerprint'
        : iris
          ? 'iris'
          : 'none';

    const label =
      face && fingerprint
        ? 'Face or fingerprint'
        : face
          ? 'Face Unlock'
          : fingerprint
            ? 'Fingerprint'
            : iris
              ? 'Iris'
              : 'Biometrics';

    return {
      available: hasHardware && enrolled,
      hasHardware,
      enrolled,
      face,
      fingerprint,
      iris,
      primary,
      label,
      level,
    };
  } catch {
    // An older device, or a module that failed to load. No biometrics is a
    // perfectly good answer; the PIN still works.
    return NO_BIOMETRICS;
  }
}

/** True when the device has enrolled biometrics we can use. */
export async function biometricAvailable(): Promise<boolean> {
  return (await getBiometricInfo()).available;
}

/**
 * Prompt the OS biometric sheet. Resolves true on success.
 *
 * `requireConfirmation: false` matters for face: Android otherwise shows a
 * "Confirm" button after recognising you, which turns a glance into a glance
 * plus a tap. Fingerprint ignores it.
 *
 * The security level is left at the default ('weak'), which also permits
 * camera-based face unlock. Stronger would be more correct for a payment app,
 * but this guards a personal ledger behind a PIN that still works — and
 * demanding Class 3 would silently disable face unlock on most of the phones
 * that have it.
 */
export async function promptBiometric(promptMessage = 'Unlock Spendly'): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Enter PIN',
      requireConfirmation: false,
    });
    return res.success;
  } catch {
    return false;
  }
}
