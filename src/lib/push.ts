/**
 * Expo push tokens: where to reach this device when the app isn't running.
 *
 * The shared-book chat is delivered two ways. While the app is awake the
 * realtime socket brings a message in milliseconds; while it isn't, the socket
 * is closed and the only thing that can reach the phone is a push. The server
 * sends those (see supabase/shared-chat.sql) and needs a token to send them
 * to — which is all this file is for.
 *
 * EVERYTHING HERE IS BEST-EFFORT. A device with no notification permission, no
 * FCM credentials in the build, or no connection simply has no token row, and
 * the chat keeps working: messages still arrive over realtime and still show
 * an unread badge. A token is how the app gets louder, never how it works.
 *
 * See CHAT_SETUP.md for the one-time project setup a token needs to be usable.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ensureChatChannel, ensureNotificationPermission } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

/** The token this device last registered, so sign-out can retire exactly it. */
let registered: string | null = null;

/**
 * The EAS project the token belongs to.
 *
 * EAS Build injects this, but the docs recommend reading it explicitly rather
 * than relying on the default — a bare `getExpoPushTokenAsync()` in a build
 * where it is missing fails with an error about the project rather than about
 * the config.
 */
function projectId(): string | undefined {
  const fromConfig = Constants.expoConfig?.extra?.eas?.projectId;
  return (fromConfig ?? Constants.easConfig?.projectId) as string | undefined;
}

/**
 * Register this device for chat pushes, and store the token against `userId`.
 *
 * Call on sign-in and whenever the account is re-established: a token can be
 * rotated by the OS, and the row is keyed by the token itself, so re-running
 * this is how the server learns about the new one.
 */
export async function registerPushToken(userId: string): Promise<void> {
  try {
    // A simulator has no push service to register with, and asking produces an
    // error rather than a token.
    if (!Device.isDevice) return;

    // Android 13+ won't show the permission prompt until a channel exists, and
    // the token request itself must come after the channel. Order matters.
    await ensureChatChannel();
    if (!(await ensureNotificationPermission())) return;

    const id = projectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      id ? { projectId: id } : undefined
    );
    if (!token) return;

    // `deleted` is set explicitly: a device that signs out and back in has a
    // retired row under the same token, and an upsert that left the flag alone
    // would leave it retired.
    const { error } = await supabase.from('push_tokens').upsert({
      id: token,
      user_id: userId,
      platform: Platform.OS,
      deleted: false,
      updated_at: new Date().toISOString(),
    });
    if (error) return;

    registered = token;
  } catch {
    // Offline, no credentials in this build, or permission declined. Chat
    // still works over realtime — see the note at the top of this file.
  }
}

/**
 * Retire this device's token on sign-out.
 *
 * Soft-deleted rather than removed, for the same reason every other table here
 * uses tombstones: the row is what the server's trigger reads, and "gone" has
 * to be a value it can see. Without this, the next person to sign in on this
 * phone would be rung about the previous account's conversations.
 */
export async function unregisterPushToken(): Promise<void> {
  const token = registered;
  registered = null;
  if (!token) return;
  try {
    await supabase
      .from('push_tokens')
      .update({ deleted: true, updated_at: new Date().toISOString() })
      .eq('id', token);
  } catch {
    // Offline. The account is signed out locally either way; the stale token
    // is cleaned up the next time this device registers.
  }
}
