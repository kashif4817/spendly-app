import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { getCurrentUserId } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { createSharedBook, joinSharedBook, SharedBookError } from '@/sync/shared';

const ACCENT = '#0B7C4F';
const DANGER = '#e5484d';

type Mode = 'create' | 'join';

/** Codes are 6 characters from an alphabet with no O/0/I/1 in it. */
const CODE_LENGTH = 6;

export default function SharedNewScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = getCurrentUserId();

  const go = async () => {
    const uid = getCurrentUserId();
    if (!uid || busy) return;

    setBusy(true);
    setError(null);
    try {
      const book =
        mode === 'create'
          ? await createSharedBook(name.trim() || 'Shared book', uid)
          : await joinSharedBook(code, uid);
      router.replace(`/shared-book?id=${encodeURIComponent(book.id)}` as Href);
    } catch (e) {
      setError(
        e instanceof SharedBookError
          ? e.message
          : 'Couldn’t reach the server. Creating and joining a book both need a connection.'
      );
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy && (mode === 'create' ? name.trim().length > 0 : code.trim().length === CODE_LENGTH);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Shared book' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <ThemedText style={styles.emoji}>🤝</ThemedText>
            <ThemedText type="subtitle" style={styles.introTitle}>
              One ledger, two people
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.introText}>
              Both of you see the same entries as they’re added. When your friend records that he
              paid, it shows up on your side as money you owe.
            </ThemedText>
          </View>

          <Segmented
            options={[
              { label: 'Create', value: 'create' },
              { label: 'Join with code', value: 'join' },
            ]}
            value={mode}
            onChange={(next) => {
              setMode(next as Mode);
              setError(null);
            }}
          />

          {mode === 'create' ? (
            <View style={styles.field}>
              <ThemedText type="smallBold">Name this book</ThemedText>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Me & Bilal"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={go}
                style={[
                  styles.input,
                  { backgroundColor: theme.backgroundElement, color: theme.text },
                ]}
              />
              <ThemedText type="small" themeColor="textSecondary">
                You’ll get a code to pass to the other person. Only one other person can join.
              </ThemedText>
            </View>
          ) : (
            <View style={styles.field}>
              <ThemedText type="smallBold">Enter the code you were given</ThemedText>
              <TextInput
                value={code}
                onChangeText={(text) =>
                  setCode(text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH))
                }
                placeholder="ABC123"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={go}
                style={[
                  styles.input,
                  styles.codeInput,
                  { backgroundColor: theme.backgroundElement, color: theme.text },
                ]}
              />
              <ThemedText type="small" themeColor="textSecondary">
                Codes expire after 7 days. If yours has, ask for a fresh one.
              </ThemedText>
            </View>
          )}

          {error && (
            <View style={[styles.errorBox, { backgroundColor: theme.backgroundElement }]}>
              <MaterialIcons name="error-outline" size={18} color={DANGER} />
              <ThemedText type="small" style={styles.errorText}>
                {error}
              </ThemedText>
            </View>
          )}

          <Pressable
            onPress={go}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submit,
              { backgroundColor: ACCENT },
              !canSubmit && styles.disabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button">
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText style={styles.submitLabel}>
                {mode === 'create' ? 'Create book' : 'Join book'}
              </ThemedText>
            )}
          </Pressable>

          {!userId && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              You need to be signed in to share a book.
            </ThemedText>
          )}
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
    gap: Spacing.four,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  intro: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  emoji: {
    fontSize: 44,
  },
  introTitle: {
    marginTop: Spacing.one,
  },
  introText: {
    textAlign: 'center',
  },
  field: {
    gap: Spacing.two,
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    minHeight: 50,
  },
  codeInput: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
    minHeight: 64,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  errorText: {
    flex: 1,
    color: DANGER,
  },
  submit: {
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  submitLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  note: {
    textAlign: 'center',
  },
});
