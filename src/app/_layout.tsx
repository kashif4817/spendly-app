import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { AnimatedSplash } from '@/components/animated-splash';
import { AuthGate } from '@/components/auth-gate';
import { ErrorBoundary } from '@/components/error-boundary';
import { UpdatePrompt } from '@/components/update-prompt';
import '@/db'; // opens the database and runs migrations on first import
import { LockGate } from '@/lock/lock-gate';
import { LockProvider } from '@/lock/provider';
import { SyncProvider } from '@/sync/provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    // The native splash (Spendly coin on emerald) shows until the app is ready.
    SplashScreen.hideAsync();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <ErrorBoundary>
        <SyncProvider>
          <LockProvider>
            <View style={styles.root}>
              <AuthGate>
                <LockGate>
                  <Stack>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="entry" options={{ presentation: 'modal', title: 'Add entry' }} />
                    <Stack.Screen name="person" options={{ title: 'Person' }} />
                    <Stack.Screen name="ledger" options={{ presentation: 'modal', title: 'Add entry' }} />
                    <Stack.Screen name="budgets" options={{ presentation: 'modal', title: 'Monthly budgets' }} />
                    <Stack.Screen name="advanced-report" options={{ title: 'Advanced Report' }} />
                    <Stack.Screen name="profile" options={{ title: 'Profile' }} />
                    <Stack.Screen name="security" options={{ presentation: 'modal', title: 'App Lock' }} />
                  </Stack>
                </LockGate>
              </AuthGate>
              <UpdatePrompt />
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
