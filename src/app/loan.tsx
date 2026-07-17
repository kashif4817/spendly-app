import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CURRENCY, MoneyColors } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import {
  addLoan,
  addLoanPayment,
  deleteLoan,
  deleteLoanPayment,
  getLoan,
  getLoanPayments,
  isLoanSettled,
  loanRemaining,
  updateLoan,
  type LoanDirection,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatRelativeDay, todayKey } from '@/lib/date';
import { formatMoney, parseAmount } from '@/lib/money';

export default function LoanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id ? Number(params.id) : null;

  // Load the existing loan once to seed the form when editing.
  const existing = useMemo(() => (editId ? getLoan(editId) : null), [editId]);

  const [direction, setDirection] = useState<LoanDirection>(existing?.direction ?? 'given');
  const [person, setPerson] = useState(existing?.person ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [day, setDay] = useState(existing?.day ?? todayKey());
  const [payment, setPayment] = useState('');

  // Live view of the loan + its repayments (updates as payments are recorded).
  const loan = useQuery(() => (editId ? getLoan(editId) : null), [editId]);
  const payments = useQuery(() => (editId ? getLoanPayments(editId) : []), [editId]);

  const accent = direction === 'given' ? MoneyColors.in : MoneyColors.out;
  const settled = loan ? isLoanSettled(loan) : false;
  const remaining = loan ? loanRemaining(loan) : 0;

  function onSave() {
    const value = parseAmount(amount);
    if (value <= 0) {
      Alert.alert('Enter an amount', 'The loan amount must be greater than zero.');
      return;
    }
    if (!person.trim()) {
      Alert.alert('Enter a name', 'Who is this loan with?');
      return;
    }
    const payload = { direction, person: person.trim(), amount: value, note: note.trim(), day };
    if (editId) {
      updateLoan(editId, payload);
    } else {
      addLoan(payload);
    }
    router.back();
  }

  function onAddPayment() {
    if (!editId || !loan) return;
    const value = parseAmount(payment);
    if (value <= 0) {
      Alert.alert('Enter an amount', 'The repayment must be greater than zero.');
      return;
    }
    if (value > remaining + 0.005) {
      Alert.alert(
        'Too much',
        `Only ${formatMoney(remaining)} is left on this loan. Enter that or less.`
      );
      return;
    }
    addLoanPayment(editId, value);
    setPayment('');
  }

  function onSettle() {
    if (!editId || remaining <= 0) return;
    Alert.alert(
      'Settle loan',
      `Record the remaining ${formatMoney(remaining)} as repaid and close this loan?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Settle', onPress: () => addLoanPayment(editId, remaining) },
      ]
    );
  }

  function onDelete() {
    if (!editId) return;
    Alert.alert('Delete loan', 'The loan and its repayment history will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteLoan(editId);
          router.back();
        },
      },
    ]);
  }

  const isToday = day === todayKey();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: editId ? 'Edit loan' : 'Add loan' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Direction */}
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { label: 'I gave a loan', value: 'given', color: MoneyColors.in },
              { label: 'I took a loan', value: 'taken', color: MoneyColors.out },
            ]}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.directionHint}>
            {direction === 'given' ? 'They owe you this money.' : 'You owe them this money.'}
          </ThemedText>

          {/* Amount */}
          <View style={[styles.amountRow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={[styles.currency, { color: accent }]}>{CURRENCY}</ThemedText>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[styles.amountInput, { color: theme.text }]}
              autoFocus={!editId}
            />
          </View>

          {/* Person */}
          <ThemedText type="smallBold" style={styles.label}>
            {direction === 'given' ? 'Who did you lend to?' : 'Who did you borrow from?'}
          </ThemedText>
          <TextInput
            value={person}
            onChangeText={setPerson}
            placeholder="e.g. Ali"
            placeholderTextColor={theme.textSecondary}
            style={[styles.textInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          />

          {/* Note */}
          <ThemedText type="smallBold" style={styles.label}>
            Note (optional)
          </ThemedText>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. For bike repair"
            placeholderTextColor={theme.textSecondary}
            style={[styles.textInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          />

          {/* Date */}
          <ThemedText type="smallBold" style={styles.label}>
            Date
          </ThemedText>
          <View style={[styles.dateRow, { backgroundColor: theme.backgroundElement }]}>
            <Pressable onPress={() => setDay(addDays(day, -1))} hitSlop={8} style={styles.stepper}>
              <ThemedText style={styles.stepperText}>‹</ThemedText>
            </Pressable>
            <View style={styles.dateMiddle}>
              <ThemedText type="smallBold">{formatRelativeDay(day)}</ThemedText>
              {!isToday && (
                <Pressable onPress={() => setDay(todayKey())} hitSlop={6}>
                  <ThemedText type="small" style={{ color: accent }}>
                    Jump to today
                  </ThemedText>
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => !isToday && setDay(addDays(day, 1))}
              hitSlop={8}
              style={styles.stepper}>
              <ThemedText style={[styles.stepperText, isToday && { opacity: 0.3 }]}>›</ThemedText>
            </Pressable>
          </View>

          {/* Save */}
          <Pressable
            onPress={onSave}
            style={({ pressed }) => [
              styles.saveButton,
              { backgroundColor: accent },
              pressed && { opacity: 0.85 },
            ]}>
            <ThemedText style={styles.saveText}>
              {editId ? 'Save changes' : 'Add loan'}
            </ThemedText>
          </Pressable>

          {/* Repayments (edit mode only) */}
          {editId && loan && (
            <>
              <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />

              <View style={styles.remainingRow}>
                <ThemedText type="smallBold">Repayments</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {settled ? 'Settled ✓' : `${formatMoney(remaining)} remaining`}
                </ThemedText>
              </View>

              {!settled && (
                <View style={[styles.paymentRow, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold" style={{ color: accent }}>
                    {CURRENCY}
                  </ThemedText>
                  <TextInput
                    value={payment}
                    onChangeText={setPayment}
                    placeholder="Repaid amount"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    style={[styles.paymentInput, { color: theme.text }]}
                    onSubmitEditing={onAddPayment}
                    returnKeyType="done"
                  />
                  <Pressable onPress={onAddPayment} hitSlop={8}>
                    <ThemedText type="smallBold" style={{ color: accent }}>
                      Add
                    </ThemedText>
                  </Pressable>
                </View>
              )}

              {payments.map((p) => (
                <View key={p.id} style={styles.paymentItem}>
                  <View style={styles.paymentItemLeft}>
                    <ThemedText type="smallBold">{formatMoney(p.amount)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatRelativeDay(p.day)}
                    </ThemedText>
                  </View>
                  <Pressable onPress={() => deleteLoanPayment(p.id)} hitSlop={8}>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      ✕
                    </ThemedText>
                  </Pressable>
                </View>
              ))}

              {!settled && remaining > 0 && (
                <Pressable onPress={onSettle} style={styles.settleButton} hitSlop={8}>
                  <ThemedText type="smallBold" style={{ color: accent }}>
                    Mark as settled
                  </ThemedText>
                </Pressable>
              )}

              <Pressable onPress={onDelete} style={styles.deleteButton} hitSlop={8}>
                <ThemedText type="smallBold" style={{ color: MoneyColors.out }}>
                  Delete loan
                </ThemedText>
              </Pressable>
            </>
          )}

          <SafeAreaView edges={['bottom']} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  directionHint: {
    marginTop: -Spacing.two,
    textAlign: 'center',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  currency: {
    fontSize: 32,
    fontWeight: '700',
  },
  amountInput: {
    flex: 1,
    fontSize: 40,
    fontWeight: '700',
    paddingVertical: Spacing.two,
  },
  label: {
    marginTop: Spacing.one,
  },
  textInput: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  stepper: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: {
    fontSize: 28,
    fontWeight: '600',
  },
  dateMiddle: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
    paddingVertical: Spacing.three,
  },
  saveButton: {
    marginTop: Spacing.three,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  saveText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    marginVertical: Spacing.one,
  },
  remainingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  paymentInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.three,
  },
  paymentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
  },
  paymentItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  settleButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  deleteButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
