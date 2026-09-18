import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accents, Spacing } from '@/constants/theme';
import { getAccentKey } from '@/lib/appearance';

const DANGER = '#e5484d';

type Props = { children: React.ReactNode };
type State = { error: Error | null; componentStack: string | null };

/**
 * Catches render-time errors anywhere below it and shows the message + stack
 * instead of letting the app hard-close. Invaluable for diagnosing crashes on
 * real builds where there's no Metro console. (Native crashes still bypass this.)
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(_error: Error, info: { componentStack?: string }) {
    this.setState({ componentStack: info.componentStack ?? null });
  }

  reset = () => this.setState({ error: null, componentStack: null });

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safe}>
          <ScrollView contentContainerStyle={styles.content}>
            <ThemedText type="subtitle" style={styles.title}>
              Something went wrong
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              Please screenshot this and send it over.
            </ThemedText>

            <ThemedText type="smallBold" style={styles.message}>
              {error.message || String(error)}
            </ThemedText>

            {!!error.stack && (
              <ThemedText type="small" style={styles.stack}>
                {error.stack}
              </ThemedText>
            )}
            {!!componentStack && (
              <ThemedText type="small" style={styles.stack}>
                {componentStack}
              </ThemedText>
            )}

            <Pressable
              onPress={this.reset}
              style={[styles.button, { backgroundColor: Accents[getAccentKey()].color }]}>
              <ThemedText style={styles.buttonText}>Try again</ThemedText>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    color: DANGER,
    fontSize: 22,
  },
  hint: {},
  message: {
    color: DANGER,
  },
  stack: {
    fontFamily: 'monospace',
    fontSize: 11,
    opacity: 0.8,
  },
  button: {
    marginTop: Spacing.three,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
});
