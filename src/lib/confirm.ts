/**
 * The app's one confirmation dialog.
 *
 * It's the platform's own alert, which is what the delete-entry prompt has
 * always used: plain, instantly familiar, and short enough to read at a glance.
 * Every confirmation now goes through here so there is exactly one of them
 * rather than a styled variant per screen.
 *
 * Button order matters and is not arbitrary. Android lays the buttons out in
 * array order with the last one as the affirmative, so Cancel has to come
 * first; iOS reads `style: 'cancel'` and places it itself. Passing
 * `destructive` paints the confirm button red on iOS and, with `cancelable`,
 * tapping outside or pressing Back counts as cancelling.
 *
 * `Alert` is deliberately NOT used for pickers — with more than three buttons
 * Android silently drops the extras, which is what `ActionSheet` exists for.
 * Two buttons is well inside what it handles.
 */

import { Alert } from 'react-native';

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paint the confirm button as destructive (delete, sign out, turn off). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

export function confirm({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: ConfirmOptions): void {
  Alert.alert(
    title,
    message,
    [
      { text: cancelLabel, style: 'cancel', onPress: onCancel },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
    ],
    { cancelable: true, onDismiss: onCancel }
  );
}

/** A one-button message: something failed, or something is done. */
export function notify(title: string, message?: string, onClose?: () => void): void {
  Alert.alert(title, message, [{ text: 'OK', onPress: onClose }], {
    cancelable: true,
    onDismiss: onClose,
  });
}
