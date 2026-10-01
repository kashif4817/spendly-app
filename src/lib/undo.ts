import { notify } from '@/lib/confirm';

export type UndoAction = {
  id: number;
  label: string;
  undo: () => void | Promise<void>;
  onExpire?: () => void | Promise<void>;
};

const listeners = new Set<() => void>();
let current: UndoAction | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

function publish(): void {
  for (const listener of listeners) listener();
}

export function getUndoAction(): UndoAction | null {
  return current;
}

export function subscribeUndo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearUndo(id?: number): void {
  if (id !== undefined && current?.id !== id) return;
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  publish();
}

function expireUndo(id: number): void {
  const action = current;
  if (!action || action.id !== id) return;
  clearUndo(id);
  void Promise.resolve(action.onExpire?.()).catch(() => {});
}

export function offerUndo(
  label: string,
  undo: UndoAction['undo'],
  durationMs = 8000,
  onExpire?: UndoAction['onExpire']
): void {
  if (current) expireUndo(current.id);
  if (timer) clearTimeout(timer);
  current = { id: nextId++, label, undo, onExpire };
  const id = current.id;
  publish();
  timer = setTimeout(() => expireUndo(id), durationMs);
}

export async function runUndo(): Promise<void> {
  const action = current;
  if (!action) return;
  clearUndo(action.id);
  try {
    await action.undo();
  } catch {
    notify('Couldn’t undo', 'This change could not be restored.');
  }
}

