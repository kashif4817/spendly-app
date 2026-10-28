import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AnimatedSplash } from '@/components/animated-splash';
import { AuthGate } from '@/components/auth-gate';
import { BalancePinHost } from '@/components/balance-pin-host';
import { ConfirmHost } from '@/components/confirm-host';
import { AuroraBackground, SceneBackground } from '@/components/glass';
import { ErrorBoundary } from '@/components/error-boundary';
import { NotificationRouter } from '@/components/notification-router';
import { isRetiredBuild, OutdatedBuildNotice } from '@/components/outdated-build-notice';
import { BottomBanners } from '@/components/bottom-banners';
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
  // so the app-wide mesh shows through — an opaque colour here would cover the
  // one thing all the glass is frosting. The Stack's own contentStyle then puts
  // an opaque base and mesh back on each scene, which is what keeps one screen
  // from showing through another mid-push.
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
                    // Every scene paints its own mesh, aligned to the root one
                    // so the header and the content below it stay continuous.
                    // See SceneBackground for why this cannot be a contentStyle.
                    screenLayout={({ children }) => <SceneBackground>{children}</SceneBackground>}
                    screenOptions={{
                      // The header stays transparent so the root mesh shows
                      // through it, continuous with each scene's own below.
                      //
                      // NOT `headerTransparent`. That was tried, to make the
                      // scene cover the header strip and stop one screen's
                      // title being drawn over the next one's mid-push. Once
                      // the header stops taking layout space its reported
                      // height goes to 0, so the padding meant to give that
                      // space back was 0 too and every pushed screen rendered
                      // its content behind the floating header.
                      //
                      // The strip therefore still shows the outgoing screen
                      // for the length of a push. It is transient and costs a
                      // frame; the alternative broke every screen outright.
                      headerStyle: { backgroundColor: 'transparent' },
                      headerShadowVisible: false,
                      // A base under the mesh, so a scene is opaque even for
                      // the frame before its background mounts.
                      contentStyle: { backgroundColor: theme.background },
                      // A screen that is off-screen stops re-rendering.
                      freezeOnBlur: true,
                    }}>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="entry" options={{ presentation: 'modal', title: 'Add expense' }} />
                    <Stack.Screen name="transaction" options={{ title: 'Entry' }} />
                    <Stack.Screen name="person" options={{ title: 'Person' }} />
                    <Stack.Screen name="ledger" options={{ presentation: 'modal', title: 'Add loan' }} />
                    <Stack.Screen name="budgets" options={{ presentation: 'modal', title: 'Monthly budgets' }} />
                    <Stack.Screen name="profile" options={{ title: 'Profile' }} />
                    <Stack.Screen name="security" options={{ presentation: 'modal', title: 'Security' }} />
                    <Stack.Screen name="settings-appearance" options={{ title: 'Appearance' }} />
                    <Stack.Screen name="settings-reminders" options={{ title: 'Reminders' }} />
                    <Stack.Screen name="settings-data" options={{ title: 'Your data' }} />
                    <Stack.Screen name="settings-about" options={{ title: 'About' }} />
                    <Stack.Screen name="shared-new" options={{ presentation: 'modal', title: 'Shared book' }} />
                    <Stack.Screen name="shared-book" options={{ title: 'Shared book' }} />
                    <Stack.Screen name="shared-entry" options={{ presentation: 'modal', title: 'Add shared entry' }} />
                    <Stack.Screen name="shared-chat" options={{ title: 'Chat' }} />
                  </Stack>
                </LockGate>
              </AuthGate>
              {/* The update banner and the undo toast, as one stack just
                  above the tab bar. */}
              <BottomBanners />
              {/* Renders nothing; opens the thread a tapped chat notification
                  was about, including when the tap launched the app. */}
              <NotificationRouter />
              {/* Above the toast and the banner: a question is the one thing
                  that should sit over everything else. */}
              {/* The PIN ask for a covered balance. Below ConfirmHost, which
                  still owns the top of the stack. */}
              <BalancePinHost />
              <ConfirmHost />
              <AnimatedSplash />
            </AuroraBackground>
          </LockProvider>
        </SyncProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

