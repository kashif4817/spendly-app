import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { RequestCard } from '@/components/entry-safety';
import { markRequestPopped } from '@/components/entry-request-popup';
import { FormLink, FormLinks } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { getCurrentUserId, getEntryRequest, getSharedEntry } from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { useSync } from '@/sync/provider';

/**
 * One approval request, where a notification about it leads.
 *
 * The phone may have been asleep when the request was made, so the row is
 * fetched first if it isn't here yet. Answered requests still open here and
 * simply say how they ended.
 */
export default function EntryRequestScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { refreshShared } = useSync();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';
  const me = getCurrentUserId() ?? '';

  const request = useQuery(() => (id ? getEntryRequest(id) : null), [id]);
  const entryExists = useQuery(
    () => (request ? !!getSharedEntry(request.entry_id) : false),
    [request?.entry_id]
  );

  const [checking, setChecking] = useState(true);
  useEffect(() => {
    // Opened on purpose, so the pop-up needn't ask about it again.
    if (id) markRequestPopped(id);
    let live = true;
    void refreshShared(true).finally(() => {
      if (live) setChecking(false);
    });
    return () => {
      live = false;
    };
  }, [id, refreshShared]);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Approval request' }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {request ? (
          <>
            <RequestCard
              request={request}
              me={me}
              onDone={() => router.back()}
              onOpenEntry={
                entryExists
                  ? () => router.push(`/shared-entry?id=${encodeURIComponent(request.entry_id)}` as Href)
                  : undefined
              }
            />
            <FormLinks>
              <FormLink
                label="Open the book"
                icon="menu-book"
                color={theme.accent}
                onPress={() =>
                  router.push(`/shared-book?id=${encodeURIComponent(request.book_id)}` as Href)
                }
              />
            </FormLinks>
          </>
        ) : checking ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.accent} />
            <ThemedText type="small" themeColor="textSecondary">
              Loading the request…
            </ThemedText>
          </View>
        ) : (
          <View style={styles.center}>
            <ThemedText type="smallBold">Request not found</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              It may be from a book you’ve left, or this phone is offline.
            </ThemedText>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  center: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  centered: {
    textAlign: 'center',
  },
});
