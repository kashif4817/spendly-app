/**
 * The app's one confirmation dialog.
 *
 * This used to be the platform's own `Alert`, which was fine when the app
 * looked like the platform. It doesn't any more: a stock system alert dropped
 * on top of the Aurora glass is the one surface in the app that belongs to
 * nobody, and "Delete forever" is the worst place to lose the thread.
 *
 * So `confirm()` and `notify()` keep exactly the API every call site already
 * uses, but instead of handing the request to the OS they put it in this
 * module-level slot. <ConfirmHost>, mounted once at the root, renders it as a
 * themed pane. Call sites didn't change at all.
 *
 * Still deliberately NOT a picker: two buttons, one question. More than that
 * is what `ActionSheet` is for.
 */

export type ConfirmRequest = {
  /** Bumped per request so a replacement re-opens rather than re-using state. */
  id: number;
  title: string;
  message?: string;
  confirmLabel: string;
  /** null for a one-button message (see `notify`). */
  cancelLabel: string | null;
  /** Paint the confirm button as destructive (delete, sign out, turn off). */
  destructive: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
};

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

let current: ConfirmRequest | null = null;
let seq = 0;

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Used by <ConfirmHost>; not meant for screens. */
export function subscribeConfirm(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Used by <ConfirmHost>; not meant for screens. */
export function getConfirmRequest(): ConfirmRequest | null {
  return current;
}

/**
 * Close whatever is open.
 *
 * The host clears the slot BEFORE running the handler, so a handler that asks
 * its own question — the second "are you really sure" on a delete that would
 * destroy history — opens cleanly instead of fighting the dialog it came from.
 */
export function dismissConfirm(): void {
  current = null;
  emit();
}

export function confirm({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: ConfirmOptions): void {
  current = {
    id: ++seq,
    title,
    message,
    confirmLabel,
    cancelLabel,
    destructive: !!destructive,
    onConfirm,
    onCancel,
  };
  emit();
}

/** A one-button message: something failed, or something is done. */
export function notify(title: string, message?: string, onClose?: () => void): void {
  current = {
    id: ++seq,
    title,
    message,
    confirmLabel: 'OK',
    cancelLabel: null,
    destructive: false,
    onConfirm: onClose,
    onCancel: onClose,
  };
  emit();
}
