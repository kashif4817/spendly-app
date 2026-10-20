import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassDivider } from '@/components/glass';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { confirm } from '@/lib/confirm';
import { shareApp } from '@/lib/share-app';
import { useLock } from '@/lock/provider';
import { useSync } from '@/sync/provider';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

/**
 * Settings, as a MENU.
 *
 * It was one scroll of seven sections, then three tabs, and neither worked:
 * the scroll meant hunting for the one switch you came in for, and the tabs
 * hid things behind a guess about which third they lived in. A menu says what
 * is here on one screen, and each row owns its own page — so a setting is
 * always one tap from a label that names it.
 *
 * Who you are stays at the top, because that is what a settings screen is
 * most often opened to check.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { name, email, avatarUrl, status, lastSyncedAt, failure, syncNow, logOut } = useSync();
  const { enabled: lockEnabled } = useLock();

  const statusLabel =
    status === 'syncing'
      ? 'Syncing…'
      : status === 'offline'
        ? 'Offline — will sync later'
        : 'Backed up';

  /** The badge beside the name: where this account stands with the cloud. */
  const statusIcon: IconName =
    status === 'syncing' ? 'sync' : status === 'offline' ? 'cloud-off' : 'cloud-done';

  const initial = (name || email || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.titleRow}>
            <ThemedText type="title" style={styles.title}>
              Settings
            </ThemedText>
            <Pressable
              onPress={() =>
                confirm({
                  title: 'Sign out?',
                  message:
                    'Your data stays safely backed up in the cloud. Sign back in anytime on this or any device to get it all back.',
                  confirmLabel: 'Sign out',
                  destructive: true,
                  onConfirm: logOut,
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              style={({ pressed }) => [styles.signOut, theme.glass, pressed && styles.pressed]}>
              <MaterialIcons name="logout" size={20} color={theme.moneyText.out} />
            </Pressable>
          </View>

          {/* Who you are: the photo as a rounded square on the left, your name
              and email beside it, and the two things this card is opened to do
              as pills underneath. The photo and the text still open the
              profile, so the card keeps its old whole-surface tap. */}
          <View style={[styles.identity, theme.glass]}>
            <Pressable
              onPress={() => router.push('/profile' as Href)}
              accessibilityRole="button"
              accessibilityLabel="Your profile"
              style={({ pressed }) => [styles.identityRow, pressed && styles.pressed]}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.placeholder, { backgroundColor: theme.accent }]}>
                  <ThemedText style={styles.initial}>{initial}</ThemedText>
                </View>
              )}
              <View style={styles.identityText}>
                <View style={styles.nameRow}>
                  <ThemedText type="smallBold" style={styles.name} numberOfLines={1}>
                    {name || email || 'Your account'}
                  </ThemedText>
                  <MaterialIcons
                    name={statusIcon}
                    size={17}
                    color={status === 'offline' ? theme.textSecondary : theme.accentTint}
                  />
                </View>
                {!!name && !!email && (
                  <View style={styles.metaRow}>
                    <MaterialIcons name="mail-outline" size={15} color={theme.textSecondary} />
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      numberOfLines={1}
                      style={styles.meta}>
                      {email}
                    </ThemedText>
                  </View>
                )}
                <View style={styles.metaRow}>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: theme.accentTint },
                      status === 'offline' && styles.dotOffline,
                    ]}
                  />
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={1}
                    style={styles.meta}>
                    {statusLabel}
                    {lastSyncedAt ? ` · ${lastSyncedAt.toLocaleTimeString()}` : ''}
                  </ThemedText>
                </View>
              </View>
            </Pressable>

            {/* Full width rather than tucked beside the text: two pills in the
                inches left over in the right-hand column come out too narrow
                to read on a small phone. */}
            <View style={styles.actions}>
              <IdentityAction
                icon="edit"
                label="Edit profile"
                onPress={() => router.push('/profile' as Href)}
              />
              <IdentityAction
                icon="sync"
                label={status === 'syncing' ? 'Syncing…' : 'Sync now'}
                tint
                onPress={() => syncNow()}
              />
            </View>
          </View>

          {/* A row the server refused. Silence here is what turns a single bad
              row into "the app is just offline", so say it out loud. */}
          {failure && (
            <View style={[styles.failure, theme.glass]}>
              <MaterialIcons name="sync-problem" size={22} color={theme.moneyText.out} />
              <View style={styles.rowText}>
                <ThemedText type="smallBold" style={{ color: theme.moneyText.out }}>
                  A change couldn&apos;t be saved to the cloud
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {failure.table} · {failure.op}
                  {failure.code ? ` · ${failure.code}` : ''}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {failure.message}
                </ThemedText>
              </View>
            </View>
          )}

          {/* One card, not three. The groupings were mine, not the user's —
              and three stacked panes made a short list look like a long one. */}
          <ThemedView type="backgroundElement" style={styles.group}>
            <MenuRow
              icon="sync"
              label="Sync now"
              hint="Back up your changes to the cloud"
              action
              onPress={() => syncNow()}
            />
            <GlassDivider />
            <MenuRow
              icon="person-outline"
              label="Profile"
              hint="Name, email and photo"
              onPress={() => router.push('/profile' as Href)}
            />
            <GlassDivider />
            <MenuRow
              icon="tune"
              label="Appearance"
              hint="Theme, accent and week start"
              onPress={() => router.push('/settings-appearance' as Href)}
            />
            <GlassDivider />
            <MenuRow
              icon="notifications-none"
              label="Reminders"
              hint="A daily nudge to log spending"
              onPress={() => router.push('/settings-reminders' as Href)}
            />
            <GlassDivider />
            <MenuRow
              icon="lock-outline"
              label="App Lock"
              hint="PIN or fingerprint"
              value={lockEnabled ? 'On' : 'Off'}
              onPress={() => router.push('/security' as Href)}
            />
            <GlassDivider />
            <MenuRow
              icon="folder-open"
              label="Your data"
              hint="Export, back up and restore"
              onPress={() => router.push('/settings-data' as Href)}
            />
            <GlassDivider />
            <MenuRow
              icon="account-balance-wallet"
              label="Budgets"
              hint="Monthly limits per category"
              onPress={() => router.push('/budgets' as Href)}
            />
            <GlassDivider />
            <MenuRow
              icon="system-update"
              label="Updates"
              hint="Version, and check for a newer one"
              onPress={() => router.push('/settings-about' as Href)}
            />
            <GlassDivider />
            {/* Its own row rather than a section buried inside About: passing
                the app on has nothing to do with checking what you're running,
                and it is one tap either way. */}
            <MenuRow
              icon="ios-share"
              label="Share Spendly"
              hint="Send a friend the download link"
              action
              onPress={() => shareApp()}
            />
          </ThemedView>

          {/* No brand footer here any more: it sat under the translucent tab
              bar at rest, and the mark and version now live on About. */}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

/** A pill under the identity card: an icon and a short label, side by side. */
function IdentityAction({
  icon,
  label,
  tint,
  onPress,
}: {
  icon: IconName;
  label: string;
  /** Carries the accent rather than the text colour — for the lesser of the two. */
  tint?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = tint ? theme.accentTint : theme.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, theme.glassWeak, pressed && styles.pressed]}>
      <MaterialIcons name={icon} size={17} color={color} />
      <ThemedText type="smallBold" style={[styles.actionLabel, { color }]} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** One line of the menu: an icon, what it is, what it covers, and a chevron. */
function MenuRow({
  icon,
  label,
  hint,
  value,
  action,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint: string;
  /** Current state shown on the right, e.g. App Lock's "On". */
  value?: string;
  /** Does the thing here and now rather than opening a page — so no chevron. */
  action?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.rowIcon, theme.glassWeak]}>
        <MaterialIcons name={icon} size={20} color={theme.accentTint} />
      </View>
      <View style={styles.rowText}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {hint}
        </ThemedText>
      </View>
      {!!value && (
        <ThemedText type="small" themeColor="textSecondary">
          {value}
        </ThemedText>
      )}
      {!action && (
        <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
      )}
    </Pressable>
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
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  title: {
    flex: 1,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
  },
  signOut: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    gap: Spacing.three,
    borderRadius: Radius.large,
    padding: Spacing.three,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  avatar: {
    width: 76,
    height: 76,
    // A rounded SQUARE, not a disc: it holds more of the photo at the same
    // width, and it squares up with the card it sits in.
    borderRadius: Radius.card,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '800',
  },
  identityText: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
  },
  name: {
    flexShrink: 1,
    fontSize: 20,
    lineHeight: 25,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
  },
  meta: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two - 2,
    minHeight: 42,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.full,
  },
  actionLabel: {
    flexShrink: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: Radius.full,
  },
  dotOffline: {
    opacity: 0.45,
  },
  failure: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    borderRadius: Radius.card,
    padding: Spacing.three,
    marginTop: Spacing.three,
  },
  group: {
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 62,
    paddingVertical: Spacing.two,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
