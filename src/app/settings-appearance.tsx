/**
 * How the app looks, and the one display preference that shapes every total:
 * which day a week starts on.
 *
 * All three settings here are device-local — which theme suits a phone is
 * about that phone, not about the account — so none of this syncs.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ACCENT_KEYS, Accents, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useAccentKey, useAppearanceMode } from '@/hooks/use-appearance';
import { useTheme } from '@/hooks/use-theme';
import { useWeekStart } from '@/hooks/use-week-start';
import { MODE_OPTIONS, setAccentKey, setAppearanceMode } from '@/lib/appearance';
import { setWeekStart } from '@/lib/week-start';

export default function SettingsAppearanceScreen() {
  const theme = useTheme();
  const mode = useAppearanceMode();
  const accentKey = useAccentKey();
  const weekStartsOn = useWeekStart();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Appearance' }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            THEME
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.copy}>
              <ThemedText type="smallBold">Light or dark</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                System follows your phone&apos;s light or dark setting
              </ThemedText>
            </View>
            <Segmented options={MODE_OPTIONS} value={mode} onChange={setAppearanceMode} />
          </ThemedView>

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            ACCENT
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.copy}>
              <ThemedText type="smallBold">Accent colour</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Used for buttons, tabs and highlights
              </ThemedText>
            </View>
            <View style={styles.swatches}>
              {ACCENT_KEYS.map((key) => {
                const selected = key === accentKey;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setAccentKey(key)}
                    style={styles.swatchHit}
                    accessibilityRole="button"
                    accessibilityLabel={Accents[key].label}
                    accessibilityState={{ selected }}>
                    <View
                      style={[
                        styles.swatch,
                        { backgroundColor: Accents[key].color },
                        // The swatches sit on glass, so a background-coloured
                        // ring would vanish; the ink colour reads either way.
                        selected && { borderColor: theme.text },
                      ]}>
                      {selected && <MaterialIcons name="check" size={18} color="#ffffff" />}
                    </View>
                    <ThemedText
                      type="small"
                      themeColor={selected ? 'text' : 'textSecondary'}
                      style={styles.swatchLabel}>
                      {Accents[key].label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </ThemedView>

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            CALENDAR
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.copy}>
              <ThemedText type="smallBold">Week starts on</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Sets the weekly totals on your dashboard, reports and calendar
              </ThemedText>
            </View>
            <Segmented
              options={[
                { label: 'Monday', value: 'mon' },
                { label: 'Sunday', value: 'sun' },
              ]}
              value={weekStartsOn === 1 ? 'mon' : 'sun'}
              onChange={(value) => setWeekStart(value === 'mon' ? 1 : 0)}
            />
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
            These are saved on this device only, so each phone you sign in on can look however
            suits it.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
  },
  section: {
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
    marginLeft: Spacing.half,
  },
  card: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  copy: {
    gap: 1,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  swatchHit: {
    alignItems: 'center',
    gap: Spacing.one,
    minWidth: 58,
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchLabel: {
    fontSize: 12,
  },
  footnote: {
    marginTop: Spacing.three,
    lineHeight: 20,
  },
});
