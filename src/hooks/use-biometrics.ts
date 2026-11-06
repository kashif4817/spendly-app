import { useEffect, useState } from 'react';

import { getBiometricInfo, type BiometricInfo } from '@/lock/app-lock';

/**
 * What this device can unlock with.
 *
 * The answer is a native round-trip, so it is cached for the session: the
 * sensors on a phone do not change while the app is open. An enrolment CAN
 * change — somebody adds a fingerprint in system settings and comes straight
 * back — so `refresh` is there for the Security screen to call when it is
 * focused, which is the only place that matters.
 */
let cached: BiometricInfo | null = null;
const listeners = new Set<(info: BiometricInfo) => void>();

async function load(): Promise<BiometricInfo> {
  const info = await getBiometricInfo();
  cached = info;
  listeners.forEach((fn) => fn(info));
  return info;
}

/** Ask the OS again — after a trip to system settings, say. */
export function refreshBiometrics(): void {
  void load();
}

export function useBiometrics(): BiometricInfo | null {
  const [info, setInfo] = useState<BiometricInfo | null>(cached);

  useEffect(() => {
    listeners.add(setInfo);
    if (!cached) void load();
    else setInfo(cached);
    return () => {
      listeners.delete(setInfo);
    };
  }, []);

  return info;
}
