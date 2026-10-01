import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Tabs } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

/**
 * Stable JS bottom tabs (react-navigation). We moved off
 * `expo-router/unstable-native-tabs` because it caused a native white-screen
 * crash on the first authenticated render in production builds.
 */
export default function TabsLayout() {
  const colors = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        // The bar is a card like everything else, lifted off the tinted page.
        tabBarStyle: {
          backgroundColor: colors.backgroundElement,
          borderTopColor: colors.backgroundSelected,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="dashboard" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="today"
        options={{
          title: 'Expenses',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="receipt-long" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="loans"
        options={{
          title: 'Loans',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="people" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="bar-chart" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="backup"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="settings" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
