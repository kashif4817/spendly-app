import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Icon, Label, NativeTabs, VectorIcon } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function TabsLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <NativeTabs backgroundColor={colors.background} labelStyle={{ color: colors.text }}>
      <NativeTabs.Trigger name="index">
        <Label>Today</Label>
        <Icon src={<VectorIcon family={MaterialIcons} name="home" />} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="reports">
        <Label>Reports</Label>
        <Icon src={<VectorIcon family={MaterialIcons} name="bar-chart" />} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <Label>History</Label>
        <Icon src={<VectorIcon family={MaterialIcons} name="history" />} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
