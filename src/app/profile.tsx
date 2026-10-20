import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassDivider } from '@/components/glass';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { getCurrentUserId } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { confirm, notify } from '@/lib/confirm';
import { removeAvatar, uploadAvatar } from '@/lib/profile';
import { captureWithCamera, compressReceipt, pickFromLibrary } from '@/lib/receipts';
import { useSync } from '@/sync/provider';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

export default function ProfileScreen() {
  const theme = useTheme();
  const { name, email, avatarUrl, reloadAvatar } = useSync();
  const [busy, setBusy] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  async function pick(source: 'camera' | 'library') {
    const uid = getCurrentUserId();
    if (!uid) return;
    try {
      const raw = source === 'camera' ? await captureWithCamera() : await pickFromLibrary();
      if (!raw) return;
      setBusy(true);
      const compressed = await compressReceipt(raw);
      await uploadAvatar(uid, compressed.uri);
      await reloadAvatar();
    } catch {
      notify('Couldn’t update photo', 'Please try again — are you online?');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const uid = getCurrentUserId();
    if (!uid) return;
    setBusy(true);
    try {
      await removeAvatar(uid);
      await reloadAvatar();
    } catch {
      // best-effort
    } finally {
      setBusy(false);
    }
  }

  const initial = (name || email || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Photo on the left, who you are on the right. A centred portrait
              pushed the name and email halfway down an otherwise empty page. */}
          <ThemedView type="backgroundElement" style={styles.identity}>
            <Pressable
              onPress={() => avatarUrl && setViewerOpen(true)}
              disabled={!avatarUrl || busy}
              accessibilityRole="imagebutton"
              accessibilityLabel={avatarUrl ? 'View your photo' : 'No photo set'}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.placeholder, { backgroundColor: theme.accent }]}>
                  <ThemedText style={styles.initial}>{initial}</ThemedText>
                </View>
              )}
              {busy && (
                <View style={styles.avatarBusy}>
                  <ActivityIndicator color="#ffffff" />
                </View>
              )}
            </Pressable>

            <View style={styles.identityText}>
              <ThemedText type="smallBold" style={styles.name} numberOfLines={1}>
                {name || 'Your name'}
              </ThemedText>
              {!!email && (
                <View style={styles.emailRow}>
                  <MaterialIcons name="mail-outline" size={14} color={theme.textSecondary} />
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.email}>
                    {email}
                  </ThemedText>
                </View>
              )}
              <Pressable
                onPress={() => pick('library')}
                disabled={busy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.editBtn,
                  theme.glassWeak,
                  busy && styles.disabled,
                  pressed && styles.pressed,
                ]}>
                <MaterialIcons name="edit" size={14} color={theme.text} />
                <ThemedText type="smallBold" style={styles.editLabel}>
                  Change photo
                </ThemedText>
              </Pressable>
            </View>
          </ThemedView>

          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.section}>
            PHOTO
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            {!!avatarUrl && (
              <>
                <Row
                  icon="visibility"
                  label="View photo"
                  disabled={busy}
                  onPress={() => setViewerOpen(true)}
                />
                <GlassDivider />
              </>
            )}
            <Row
              icon="photo-camera"
              label="Take a photo"
              onPress={() => pick('camera')}
              disabled={busy}
            />
            <GlassDivider />
            <Row
              icon="photo-library"
              label="Choose from gallery"
              onPress={() => pick('library')}
              disabled={busy}
            />
            {!!avatarUrl && (
              <>
                <GlassDivider />
                <Row
                  icon="delete-outline"
                  label="Remove photo"
                  destructive
                  disabled={busy}
                  onPress={() =>
                    confirm({
                      title: 'Remove your photo?',
                      message: 'Your initial will be shown instead. You can add a new one any time.',
                      confirmLabel: 'Remove',
                      destructive: true,
                      onConfirm: remove,
                    })
                  }
                />
              </>
            )}
          </ThemedView>
        </ScrollView>
      </SafeAreaView>

      {/* Full-screen photo viewer — same shape as the receipt one. */}
      <Modal
        visible={viewerOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setViewerOpen(false)}>
        <Pressable
          style={styles.viewerBackdrop}
          onPress={() => setViewerOpen(false)}
          accessibilityLabel="Close photo">
          {!!avatarUrl && (
            <Image source={{ uri: avatarUrl }} style={styles.viewerImage} contentFit="contain" />
          )}
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

/** A tappable line inside a pane. */
function Row({
  icon,
  label,
  destructive,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = destructive ? theme.moneyText.out : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && styles.pressed]}>
      <MaterialIcons name={icon} size={20} color={color} />
      <ThemedText type="smallBold" style={[styles.rowLabel, { color }]}>
        {label}
      </ThemedText>
      {!destructive && (
        <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
      )}
    </Pressable>
  );
}

const AVATAR = 76;

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: {
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
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.large,
    padding: Spacing.three,
  },
  // A rounded SQUARE, not a circle: it anchors the left edge of the card and
  // sits square with the text block beside it.
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: Radius.medium,
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
  avatarBusy: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: Radius.medium,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: {
    flex: 1,
    gap: Spacing.one,
  },
  name: {
    fontSize: 19,
    lineHeight: 25,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  email: {
    flexShrink: 1,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
    minHeight: 34,
    marginTop: Spacing.one,
  },
  editLabel: {
    fontSize: 13,
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
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 50,
    paddingVertical: Spacing.two,
  },
  rowLabel: {
    flex: 1,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  viewerImage: {
    width: '100%',
    height: '80%',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
});
