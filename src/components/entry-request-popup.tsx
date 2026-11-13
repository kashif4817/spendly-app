/**
 * The pop-up that asks you about the other member's change request.
 *
 * When a request for YOUR approval reaches this phone while Spendly is open —
 * live over the socket, or in the next pull — it is put in front of you once,
 * with Approve and Turn down right there. It closes by itself after a minute.
 * Closing it answers nothing: the request stays waiting in the book (a banner
 * at the top, and in Activity) until it is approved, turned down, withdrawn,
 * or its 7 days run out.
 *
 * Each request pops up once per install, remembered across restarts, so an
 * unanswered one doesn't ambush you every time the app opens — the banner and
 * the People list mark are what keep it in view after that.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { RequestCard } from '@/components/entry-safety';
import { ThemedText } from '@/components/themed-text';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import { getOpenRequests } from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { claimApprovalShown } from '@/lib/notifications';
import { useLock } from '@/lock/provider';
import { useSync } from '@/sync/provider';

/** How long the pop-up stays before stepping aside on its own. */
const SHOW_FOR_MS = 60_000;
/** A beat after a request turns up, so it never lands on top of the splash. */
const SETTLE_MS = 1_200;

const POPPED_KEY = 'spendly.approvals.popped';
const POPPED_CAP = 100;

let popped: Set<string> | null = null;
const loading: Promise<Set<string>> = AsyncStorage.getItem(POPPED_KEY)
  .then((raw) => new Set<string>(raw ? (JSON.parse(raw) as string[]) : []))
  .catch(() => new Set<string>())
  .then((set) => {
    popped = set;
    return set;
  });

/**
 * Note a request as already put in front of you — by this pop-up, or because
 * you opened it yourself (from a notification, say).
 */
export function markRequestPopped(requestId: string): void {
  claimApprovalShown(requestId);
  const add = (set: Set<string>) => {
    if (set.has(requestId)) return;
    set.add(requestId);
    const list = [...set].slice(-POPPED_CAP);
    AsyncStorage.setItem(POPPED_KEY, JSON.stringify(list)).catch(() => {});
  };
  // Synchronously when the set is already here, so the render that follows
  // already counts this one as shown.
  if (popped) add(popped);
  else void loading.then(add);
}

export function EntryRequestPopup() {
  const theme = useTheme();
  const { ready, email, userId } = useSync();
  const { isLocked } = useLock();
  // From the provider's STATE, not getCurrentUserId(): this mounts at the root
  // before anyone is signed in, and reading the module variable here kept its
  // first answer — nobody — so a request you sent popped up on your own phone
  // asking you to approve it.
  const me = userId ?? '';

  const open = useQuery(() => getOpenRequests(), []);
  // Only the other member's requests are yours to answer. With no account
  // known yet, nothing is.
  const forMe = useMemo(
    () => (me ? open.filter((r) => r.requester_id !== me) : []),
    [open, me]
  );

  const [loaded, setLoaded] = useState(popped !== null);
  useEffect(() => {
    if (!loaded) void loading.then(() => setLoaded(true));
  }, [loaded]);

  const [shownId, setShownId] = useState<string | null>(null);
  const shown = forMe.find((r) => r.id === shownId) ?? null;

  const candidate =
    loaded && ready && !!email && !isLocked && !shownId
      ? (forMe.find((r) => !popped?.has(r.id)) ?? null)
      : null;

  // Bring the next unseen request forward, after a beat.
  useEffect(() => {
    if (!candidate) return;
    const id = candidate.id;
    const timer = setTimeout(() => {
      markRequestPopped(id);
      setShownId(id);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [candidate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A minute, then step aside. The request itself stays open in the book.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!shownId) return;
    closeTimer.current = setTimeout(() => setShownId(null), SHOW_FOR_MS);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [shownId]);

  // Answered elsewhere (the other phone of yours, or withdrawn by them).
  useEffect(() => {
    if (shownId && !shown) setShownId(null);
  }, [shownId, shown]);

  if (!shown || isLocked) return null;

  const close = () => setShownId(null);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Later">
        <Pressable onPress={() => {}} style={styles.wrap}>
          <ScrollView
            style={[styles.sheet, theme.glassOverlay]}
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}>
            <ThemedText type="subtitle" style={styles.title}>
              Your approval is needed
            </ThemedText>
            <RequestCard request={shown} me={me} onDone={close} />
            <View style={styles.footer}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
                Not now? It stays in the book until you answer.
              </ThemedText>
              <Pressable onPress={close} hitSlop={10} accessibilityRole="button">
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  Later
                </ThemedText>
              </Pressable>
            </View>
          </ScrollView>
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
    paddingHorizontal: Spacing.three,
  },
  wrap: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
  },
  sheet: {
    borderRadius: Radius.large,
    flexGrow: 0,
  },
  sheetContent: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  flex: { flex: 1 },
});
