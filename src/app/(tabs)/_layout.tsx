import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_HEIGHT } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

/**
 * Stable JS bottom tabs (react-navigation). We moved off
 * `expo-router/unstable-native-tabs` because it caused a native white-screen
 * crash on the first authenticated render in production builds.
 *
 * The bar is deliberately PLAIN: an icon, a label, and the accent colour to
 * say which tab is current. It used to put a lit capsule behind the active
 * icon, and that was the bug behind the clipping — react-navigation renders
 * `tabBarIcon` inside a fixed 31x28 box, so a 48-wide capsule spilled out of
 * its slot and over its neighbours. Nothing here is allowed to be bigger than
 * that slot.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accentTint,
        tabBarInactiveTintColor: theme.textSecondary,
        // Never scale with the system font setting. The bar is a fixed height
        // and a label that grows has nowhere to grow into — it just loses its
        // descenders.
        tabBarAllowFontScaling: false,
        // The bar is a pane of glass, so it is ABSOLUTE and content scrolls
        // underneath it — a bar that content stops short of has nothing behind
        // it to let through, which is the whole point of the material. Every
        // scrolling screen pads its own bottom by `BottomTabInset` to match.
        //
        // Height is the bar PLUS the safe-area inset, never the inset carved
        // out of a fixed height: doing that eats the gesture inset on a
        // gesture-nav phone and squeezes the row into the handle.
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingTop: 0,
          paddingBottom: insets.bottom,
        },
        tabBarBackground: () => <TabBarGlass />,
        // The row's whole budget, spelled out, so it cannot overrun:
        // 8 + 28 (icon slot) + 2 + 14 (label) + 8 = 60, inside TAB_BAR_HEIGHT.
        tabBarItemStyle: {
          paddingTop: 8,
          paddingBottom: 8,
        },
        tabBarIconStyle: {
          marginBottom: 2,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: '600',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: (props) => <TabIcon name="dashboard" {...props} />,
        }}
      />
      <Tabs.Screen
        name="today"
        options={{
          title: 'Expenses',
          tabBarIcon: (props) => <TabIcon name="receipt-long" {...props} />,
        }}
      />
      <Tabs.Screen
        name="loans"
        options={{
          title: 'Loans',
          tabBarIcon: (props) => <TabIcon name="people" {...props} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: (props) => <TabIcon name="bar-chart" {...props} />,
        }}
      />
      <Tabs.Screen
        name="backup"
        options={{
          title: 'Settings',
          tabBarIcon: (props) => <TabIcon name="settings" {...props} />,
        }}
      />
    </Tabs>
  );
}

/** A tab's glyph, centred in the slot react-navigation gives it. */
function TabIcon({ name, color }: { name: IconName; color: string }) {
  return (
    <View style={styles.iconWrap}>
      <MaterialIcons name={name} color={color} size={24} />
    </View>
  );
}

/**
 * The pane behind the tabs.
 *
 * Much more opaque than an ordinary card: the whole app slides under it, and
 * at card weight the numbers on the screen behind stayed legible THROUGH the
 * bar and tangled with the labels. The lit top edge is what separates it from
 * the content rather than a border.
 */
function TabBarGlass() {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: dark ? 'rgba(13,11,32,0.96)' : 'rgba(252,251,255,0.96)',
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: dark ? 'rgba(255,255,255,0.16)' : 'rgba(23,18,67,0.08)',
          boxShadow: [
            {
              offsetX: 0,
              offsetY: -8,
              blurRadius: 28,
              color: dark ? 'rgba(0,0,0,0.40)' : 'rgba(23,18,67,0.10)',
            },
          ],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  // Matches react-navigation's own icon slot exactly. Anything larger is
  // drawn outside it and over the tabs on either side.
  iconWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
