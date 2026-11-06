/**
 * "Typing…", over Realtime broadcast.
 *
 * WHY BROADCAST AND NOT A TABLE: a keystroke is worth knowing about for about
 * three seconds and worth nothing afterwards. Writing that to Postgres would
 * mean a row per keystroke, a migration, an RLS policy, outbox traffic and a
 * cursor — all to store something that is stale before it finishes syncing.
 * Broadcast is the opposite trade: nothing is stored, nothing is replayed, and
 * a message that doesn't arrive simply means the indicator doesn't show, which
 * is exactly how wrong it is allowed to be.
 *
 * SCOPE: one channel per book, named after the book's id. Book ids are random
 * UUIDs handed out by create_book(), so knowing the name means already being
 * able to read the thread — and the only thing on the wire is "someone is
 * typing", with no content in it at all.
 *
 * The channel is opened when a thread is on screen and closed when it leaves,
 * so a phone in a pocket is not holding one open per book.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import { getCurrentUserId } from '@/db';
import { supabase } from '@/lib/supabase';

/**
 * How long one announcement stands for.
 *
 * Longer than the re-announce interval below, so a steady typist never
 * flickers; short enough that someone who puts their phone down mid-sentence
 * stops "typing" on their own. Nothing guarantees a stop ever arrives — the
 * app may be killed mid-word — so the indicator has to expire by itself.
 */
const CLAIM_MS = 4500;

/** How often a continuing typist re-announces. One message per couple of seconds. */
const REANNOUNCE_MS = 1800;

const EVENT = 'typing';

let channel: RealtimeChannel | null = null;
let channelBook: string | null = null;

/** When our own last announcement went out, for the throttle. */
let lastSentAt = 0;

/**
 * Whether the other member is typing, as a plain boolean rather than a
 * deadline. `useSyncExternalStore` compares snapshots by identity and may read
 * one at any time, so a value that changes on its own as the clock moves would
 * tear; this flips only in `emit`.
 */
let peerTyping = false;
let expiry: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

function emit(next: boolean): void {
  if (peerTyping === next) return;
  peerTyping = next;
  listeners.forEach((fn) => fn());
}

function clearExpiry(): void {
  if (expiry) clearTimeout(expiry);
  expiry = null;
}

function heard(typing: boolean): void {
  clearExpiry();
  if (!typing) {
    emit(false);
    return;
  }
  emit(true);
  expiry = setTimeout(() => emit(false), CLAIM_MS);
}

/**
 * Listen for the other member typing in this book.
 *
 * Safe to call with the book already being watched — it does nothing. Calling
 * it with a different book closes the old channel first, so there is never
 * more than one open.
 */
export function watchTyping(bookId: string): void {
  if (channelBook === bookId && channel) return;
  stopWatchingTyping();
  if (!bookId) return;

  channelBook = bookId;
  const next = supabase.channel(`typing:${bookId}`, {
    // We know perfectly well when we are typing; hearing it back would only
    // make us show the indicator to ourselves.
    config: { broadcast: { self: false } },
  });

  next.on('broadcast', { event: EVENT }, (payload: { payload?: { from?: string; on?: boolean } }) => {
    const me = getCurrentUserId();
    const from = payload?.payload?.from;
    // Belt and braces: `self: false` should already have filtered this, but a
    // reconnect can briefly deliver our own frame back.
    if (!from || (me && from === me)) return;
    heard(payload?.payload?.on !== false);
  });

  next.subscribe();
  channel = next;
}

/** Close the channel and forget what it told us. */
export function stopWatchingTyping(): void {
  clearExpiry();
  emit(false);
  lastSentAt = 0;
  channelBook = null;

  if (!channel) return;
  const open = channel;
  channel = null;
  supabase.removeChannel(open).catch(() => {
    // Already gone, or offline. Nothing left to close either way.
  });
}

/**
 * Say that we are typing. Call it on every keystroke — it throttles itself.
 *
 * Deliberately fire-and-forget: a dropped frame costs a few seconds of a
 * indicator on someone else's screen, and waiting on an ack would put network
 * latency in the path of the keyboard.
 */
export function signalTyping(): void {
  if (!channel) return;
  const now = Date.now();
  if (now - lastSentAt < REANNOUNCE_MS) return;
  lastSentAt = now;
  // Caught, not awaited: `send` rejects if the channel is still connecting,
  // and an unhandled rejection over a keystroke is a red box for nothing.
  channel.send({
    type: 'broadcast',
    event: EVENT,
    payload: { from: getCurrentUserId() ?? '', on: true },
  }).catch(() => {});
}

/**
 * Say that we have stopped — sent, cleared, or left the screen.
 *
 * Worth an explicit frame rather than letting the claim lapse: the moment a
 * message lands, an indicator still saying "typing…" above it reads as a
 * second message that never comes.
 */
export function signalStoppedTyping(): void {
  if (!channel) return;
  lastSentAt = 0;
  channel.send({
    type: 'broadcast',
    event: EVENT,
    payload: { from: getCurrentUserId() ?? '', on: false },
  }).catch(() => {});
}

export function isPeerTyping(): boolean {
  return peerTyping;
}

export function subscribeTyping(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
