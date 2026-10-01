import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { AnimatedSplash } from '@/components/animated-splash';
import { AuthGate } from '@/components/auth-gate';
import { ErrorBoundary } from '@/components/error-boundary';
import { isRetiredBuild, OutdatedBuildNotice } from '@/components/outdated-build-notice';
import { UpdatePrompt } from '@/components/update-prompt';
import { UndoToast } from '@/components/undo-toast';
import '@/db'; // opens the database and runs migrations on first import
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { LockGate } from '@/lock/lock-gate';
import { LockProvider } from '@/lock/provider';
import { SyncProvider } from '@/sync/provider';

SplashScreen.preventAutoHideAsync();

const RETIRED_BUILD = isRetiredBuild();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = useTheme();

  useEffect(() => {
    // The native splash (Spendly mark on white / navy-black) shows until the app is ready.
    SplashScreen.hideAsync();
  }, []);

  // Stack headers and screen backgrounds come from the navigation theme, so it
  // gets the app's palette — the stock one is iOS blue on grey and clashed with
  // every screen that isn't a tab.
  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.accent,
      background: theme.background,
      card: theme.background,
      text: theme.text,
      border: theme.backgroundSelected,
    },
  };

  // Old pinned builds get only the "install the new version" screen — nothing
  // else loads, so no screen can reach for native code that build lacks.
  if (RETIRED_BUILD) {
    return (
      <ThemeProvider value={navTheme}>
        <OutdatedBuildNotice />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={navTheme}>
      <ErrorBoundary>
        <SyncProvider>
          <LockProvider>
            <View style={styles.root}>
              <AuthGate>
                <LockGate>
                  <Stack>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="entry" options={{ presentation: 'modal', title: 'Add expense' }} />
                    <Stack.Screen name="transaction" options={{ title: 'Entry' }} />
                    <Stack.Screen name="person" options={{ title: 'Person' }} />
                    <Stack.Screen name="ledger" options={{ presentation: 'modal', title: 'Add loan' }} />
                    <Stack.Screen name="budgets" options={{ presentation: 'modal', title: 'Monthly budgets' }} />
                    <Stack.Screen name="profile" options={{ title: 'Profile' }} />
                    <Stack.Screen name="security" options={{ presentation: 'modal', title: 'App Lock' }} />
                    <Stack.Screen name="shared-new" options={{ presentation: 'modal', title: 'Shared book' }} />
                    <Stack.Screen name="shared-book" options={{ title: 'Shared book' }} />
                    <Stack.Screen name="shared-entry" options={{ presentation: 'modal', title: 'Add shared entry' }} />
                  </Stack>
                </LockGate>
              </AuthGate>
              <UpdatePrompt />
              <UndoToast />
              <AnimatedSplash />
            </View>
          </LockProvider>
        </SyncProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
