import { LockScreen } from '@/components/lock-screen';
import { useLock } from '@/lock/provider';

/** Shows the lock screen over the app whenever it's locked. */
export function LockGate({ children }: { children: React.ReactNode }) {
  const { ready, isLocked } = useLock();
  if (ready && isLocked) return <LockScreen />;
  return <>{children}</>;
}
