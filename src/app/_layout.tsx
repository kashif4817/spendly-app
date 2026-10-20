import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AnimatedSplash } from '@/components/animated-splash';
import { AuthGate } from '@/components/auth-gate';
import { ConfirmHost } from '@/components/confirm-host';
import { AuroraBackground } from '@/components/glass';
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
  // Navigation paints the screen and header backgrounds. They go TRANSPARENT
  // so the app-wide mesh shows through every screen and header — an opaque
  // colour here would cover the one thing all the glass is frosting.
  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.accentTint,
      background: 'transparent',
      card: 'transparent',
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
            <AuroraBackground>
              <AuthGate>
                <LockGate>
                  <Stack
                    screenOptions={{
                      // Transparent headers and scenes: the mesh is mounted
                      // above this Stack, so it shows through both.
                      //
                      // NOT `headerTransparent`, which would also take the
                      // header out of the layout and drop every screen's
                      // content behind it. The header keeps its space and
                      // simply paints nothing.
                      headerStyle: { backgroundColor: 'transparent' },
                      headerShadowVisible: false,
                      contentStyle: { backgroundColor: 'transparent' },
                    }}>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="entry" options={{ presentation: 'modal', title: 'Add expense' }} />
                    <Stack.Screen name="transaction" options={{ title: 'Entry' }} />
                    <Stack.Screen name="person" options={{ title: 'Person' }} />
                    <Stack.Screen name="ledger" options={{ presentation: 'modal', title: 'Add loan' }} />
                    <Stack.Screen name="budgets" options={{ presentation: 'modal', title: 'Monthly budgets' }} />
                    <Stack.Screen name="profile" options={{ title: 'Profile' }} />
                    <Stack.Screen name="security" options={{ presentation: 'modal', title: 'App Lock' }} />
                    <Stack.Screen name="settings-appearance" options={{ title: 'Appearance' }} />
                    <Stack.Screen name="settings-reminders" options={{ title: 'Reminders' }} />
                    <Stack.Screen name="settings-data" options={{ title: 'Your data' }} />
                    <Stack.Screen name="settings-about" options={{ title: 'About' }} />
                    <Stack.Screen name="shared-new" options={{ presentation: 'modal', title: 'Shared book' }} />
                    <Stack.Screen name="shared-book" options={{ title: 'Shared book' }} />
                    <Stack.Screen name="shared-entry" options={{ presentation: 'modal', title: 'Add shared entry' }} />
                  </Stack>
                </LockGate>
              </AuthGate>
              <UpdatePrompt />
              <UndoToast />
              {/* Above the toast and the banner: a question is the one thing
                  that should sit over everything else. */}
              <ConfirmHost />
              <AnimatedSplash />
            </AuroraBackground>
          </LockProvider>
        </SyncProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

