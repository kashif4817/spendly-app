import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CURRENCY } from '@/constants/app';
import { Spacing } from '@/constants/theme';
import { getBudgets, getCategories, OVERALL_BUDGET, setBudget } from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { parseAmount } from '@/lib/money';

const ACCENT = '#208AEF';

export default function BudgetsScreen() {
  const theme = useTheme();
  const router = useRouter();

  const categories = useQuery(() => getCategories('out'));

  // Seed the inputs from saved budgets once; edits stay local until Save.
  const initial = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of getBudgets()) map[b.category] = String(b.amount);
    return map;
  }, []);
  const [values, setValues] = useState<Record<string, string>>(initial);

  function setValue(category: string, text: string) {
    setValues((prev) => ({ ...prev, [category]: text }));
  }

  function onSave() {
    setBudget(OVERALL_BUDGET, parseAmount(values[OVERALL_BUDGET] ?? ''));
    for (const cat of categories) {
      setBudget(cat.name, parseAmount(values[cat.name] ?? ''));
    }
    router.back();
  }

  function renderRow(key: string, emoji: string, name: string) {
    return (
      <View key={key} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText style={styles.emoji}>{emoji}</ThemedText>
        <ThemedText type="small" style={styles.name} numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {CURRENCY}
        </ThemedText>
        <TextInput
          value={values[key] ?? ''}
          onChangeText={(text) => setValue(key, text)}
          placeholder="No limit"
          placeholderTextColor={theme.textSecondary}
          keyboardType="decimal-pad"
          style={[styles.input, { color: theme.text }]}
        />
      </View>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Monthly budgets' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <ThemedText type="small" themeColor="textSecondary">
            Limits apply to money out and reset every month. Leave a field empty for no limit.
          </ThemedText>

          <ThemedText type="smallBold" style={styles.label}>
            Overall
          </ThemedText>
          {renderRow(OVERALL_BUDGET, '🎯', 'All spending')}

          <ThemedText type="smallBold" style={styles.label}>
            Per category
          </ThemedText>
          {categories.map((cat) => renderRow(cat.name, cat.emoji, cat.name))}

          <Pressable
            onPress={onSave}
            style={({ pressed }) => [styles.saveButton, pressed && { opacity: 0.85 }]}>
            <ThemedText style={styles.saveText}>Save budgets</ThemedText>
          </Pressable>

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
    gap: Spacing.two,
  },
  label: {
    marginTop: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  emoji: {
    fontSize: 16,
  },
  name: {
    flex: 1,
  },
  input: {
    minWidth: 100,
    textAlign: 'right',
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: Spacing.three,
  },
  saveButton: {
    marginTop: Spacing.three,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    backgroundColor: ACCENT,
  },
  saveText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
});
