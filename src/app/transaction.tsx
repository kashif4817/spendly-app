import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormCard, FormLink, FormLinks, FormRow, PrimaryButton } from '@/components/form';
import { confirm } from '@/lib/confirm';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { Radius, Spacing } from '@/constants/theme';
import {
  addTransaction,
  deleteTransaction,
  getTransaction,
  restoreTransaction,
} from '@/db';
import { useCategoryIcon, useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { formatFullDate, formatTime, todayKey } from '@/lib/date';
import { formatSigned } from '@/lib/money';
import { deleteReceipt, receiptUrl } from '@/lib/receipts';
import { offerUndo } from '@/lib/undo';

/**
 * One entry, read-only: what it was, when, and its receipt. Editing is a
 * deliberate step from here, so tapping an entry to look at it can't change it.
 */
export default function TransactionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const iconFor = useCategoryIcon();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Live, so coming back from the edit screen shows the saved changes.
  const entry = useQuery(() => (id ? getTransaction(id) : null), [id]);

  const [receiptView, setReceiptView] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const receiptPath = entry?.receipt_path ?? null;
  useEffect(() => {
    let active = true;
    if (receiptPath) receiptUrl(receiptPath).then((url) => active && setReceiptView(url));
    else setReceiptView(null);
    return () => {
      active = false;
    };
  }, [receiptPath]);

  if (!entry) {
    return (
      <ThemedView style={[styles.container, styles.gone]}>
        <Stack.Screen options={{ title: 'Entry' }} />
        <ThemedText type="smallBold">This entry no longer exists.</ThemedText>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Go back
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const isIncome = entry.type === 'in';
  const color = isIncome ? MoneyColors.in : MoneyColors.out;

  const duplicate = () => {
    const copyId = addTransaction({
      type: entry.type,
      amount: entry.amount,
      category: entry.category,
      note: entry.note,
      day: todayKey(),
    });
    offerUndo('Copied to today', () => deleteTransaction(copyId));
    router.back();
  };

  const remove = () => {
    confirm({
      title: 'Delete entry',
      message: 'This removes the entry. You can undo for a few seconds.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        const removed = entry;
        deleteTransaction(removed.id);
        offerUndo(
          'Entry deleted',
          () => restoreTransaction(removed),
          8000,
          () => (removed.receipt_path ? deleteReceipt(removed.receipt_path) : undefined)
        );
        router.back();
      },
    });
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: isIncome ? 'Income' : 'Expense' }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* What and how much */}
        <ThemedView type="backgroundElement" style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: `${color}1A` }]}>
            <MaterialIcons name={iconFor(entry.category, entry.type)} size={26} color={color} />
          </View>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {entry.category}
          </ThemedText>
          <ThemedText style={[styles.amount, { color }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatSigned(isIncome ? entry.amount : -entry.amount)}
          </ThemedText>
          <View style={[styles.typePill, { backgroundColor: `${color}1A` }]}>
            <MaterialIcons name={isIncome ? 'call-received' : 'call-made'} size={14} color={color} />
            <ThemedText type="smallBold" style={[styles.typeLabel, { color }]}>
              {isIncome ? 'Money in' : 'Money out'}
            </ThemedText>
          </View>
        </ThemedView>

        <FormCard>
          <FormRow icon="event" label="Date">
            <ThemedText type="smallBold">{formatFullDate(entry.day)}</ThemedText>
          </FormRow>
          <FormRow icon="schedule" label="Added at">
            <ThemedText type="smallBold">{formatTime(entry.created_at)}</ThemedText>
          </FormRow>
          {entry.note?.trim() ? (
            <FormRow icon="notes" label="Note">
              <ThemedText>{entry.note.trim()}</ThemedText>
            </FormRow>
          ) : null}
          {receiptPath ? (
            <FormRow icon="receipt-long" label="Receipt">
              {receiptView ? (
                <Pressable onPress={() => setViewerOpen(true)} accessibilityLabel="View receipt">
                  <Image source={{ uri: receiptView }} style={styles.thumb} contentFit="cover" />
                </Pressable>
              ) : (
                <ThemedText type="small" themeColor="textSecondary">
                  Loading…
                </ThemedText>
              )}
            </FormRow>
          ) : null}
        </FormCard>

        <PrimaryButton
          label="Edit"
          color={theme.accent}
          onPress={() => router.push({ pathname: '/entry', params: { id: entry.id } })}
        />

        <FormLinks>
          <FormLink label="Duplicate for today" icon="content-copy" color={theme.accent} onPress={duplicate} />
          <FormLink label="Delete" icon="delete-outline" color={MoneyColors.out} onPress={remove} />
        </FormLinks>

        <SafeAreaView edges={['bottom']} />
      </ScrollView>

      {/* Full-screen receipt */}
      <Modal
        visible={viewerOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setViewerOpen(false)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerOpen(false)}>
          {receiptView && (
            <Image source={{ uri: receiptView }} style={styles.viewerImage} contentFit="contain" />
          )}
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gone: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  hero: {
    borderRadius: Radius.card,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.one,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  amount: {
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '800',
  },
  typePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: Spacing.one,
  },
  typeLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: Radius.medium,
    marginTop: Spacing.one,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  viewerImage: {
    width: '100%',
    height: '80%',
  },
});
