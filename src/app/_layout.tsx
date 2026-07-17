import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';

import { AnimatedSplash } from '@/components/animated-splash';
import { AuthGate } from '@/components/auth-gate';
import { UpdatePrompt } from '@/components/update-prompt';
import '@/db'; // opens the database and runs migrations on first import
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
      <SyncProvider>
        <View style={styles.root}>
          <AuthGate>
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="entry" options={{ presentation: 'modal', title: 'Add entry' }} />
              <Stack.Screen name="loan" options={{ presentation: 'modal', title: 'Add loan' }} />
              <Stack.Screen name="budgets" options={{ presentation: 'modal', title: 'Monthly budgets' }} />
            </Stack>
          </AuthGate>
          <UpdatePrompt />
          <AnimatedSplash />
        </View>
      </SyncProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
