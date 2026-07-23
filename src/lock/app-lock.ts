/**
 * App-lock storage + crypto. The PIN is never stored in the clear — only a
 * salted SHA-256 hash, kept in the OS secure store (Keychain / Keystore).
 * Biometric unlock is delegated to expo-local-authentication.
 */

import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const PIN_KEY = 'spendly_lock_pin_hash';
const SALT_KEY = 'spendly_lock_salt';
const ENABLED_KEY = 'spendly_lock_enabled';
const BIOMETRIC_KEY = 'spendly_lock_biometric';

export const PIN_LENGTH = 4;

export type LockConfig = {
  /** App lock is on (a PIN has been set). */
  enabled: boolean;
  /** Biometric unlock is preferred when available. */
  biometric: boolean;
};

export async function getLockConfig(): Promise<LockConfig> {
  const [enabled, biometric] = await Promise.all([
    SecureStore.getItemAsync(ENABLED_KEY),
    SecureStore.getItemAsync(BIOMETRIC_KEY),
  ]);
  return { enabled: enabled === '1', biometric: biometric === '1' };
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

/** Set (or change) the PIN and turn app lock on. */
export async function setPin(pin: string): Promise<void> {
  let salt = await SecureStore.getItemAsync(SALT_KEY);
  if (!salt) {
    salt = Crypto.randomUUID();
    await SecureStore.setItemAsync(SALT_KEY, salt);
  }
  await SecureStore.setItemAsync(PIN_KEY, await hashPin(pin, salt));
  await SecureStore.setItemAsync(ENABLED_KEY, '1');
}

export async function verifyPin(pin: string): Promise<boolean> {
  const [salt, stored] = await Promise.all([
    SecureStore.getItemAsync(SALT_KEY),
    SecureStore.getItemAsync(PIN_KEY),
  ]);
  if (!salt || !stored) return false;
  return (await hashPin(pin, salt)) === stored;
}

export async function setBiometricEnabled(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_KEY, on ? '1' : '0');
}

/** Turn app lock off and forget the PIN. */
export async function disableLock(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(PIN_KEY),
    SecureStore.deleteItemAsync(ENABLED_KEY),
    SecureStore.deleteItemAsync(BIOMETRIC_KEY),
  ]);
}

/** True when the device has enrolled biometrics we can use. */
export async function biometricAvailable(): Promise<boolean> {
  const [hasHardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && enrolled;
}

/** Prompt the OS biometric sheet. Resolves true on success. */
export async function promptBiometric(): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Spendly',
      fallbackLabel: 'Enter PIN',
    });
    return res.success;
  } catch {
    return false;
  }
}
