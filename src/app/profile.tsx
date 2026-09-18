import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet } from '@/components/action-sheet';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { getCurrentUserId } from '@/db';
import { removeAvatar, uploadAvatar } from '@/lib/profile';
import { captureWithCamera, compressReceipt, pickFromLibrary } from '@/lib/receipts';
import { useSync } from '@/sync/provider';

export default function ProfileScreen() {
  const theme = useTheme();
  const { name, email, avatarUrl, reloadAvatar } = useSync();
  const [busy, setBusy] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);

  const openChooser = () => setChooserOpen(true);

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
      Alert.alert('Couldn’t update photo', 'Please try again — are you online?');
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
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <Pressable onPress={openChooser} style={styles.avatarWrap} disabled={busy}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.placeholder, { backgroundColor: theme.accent }]}>
                <ThemedText style={styles.initial}>{initial}</ThemedText>
              </View>
            )}
            <View style={[styles.editBadge, { backgroundColor: theme.accent }]}>
              <MaterialIcons name="photo-camera" size={16} color="#ffffff" />
            </View>
            {busy && (
              <View style={styles.avatarBusy}>
                <ActivityIndicator color="#ffffff" />
              </View>
            )}
          </Pressable>

          <ThemedText type="subtitle" style={styles.name}>
            {name || 'Your name'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {email}
          </ThemedText>

          <Pressable onPress={openChooser} style={styles.changeBtn} hitSlop={8} disabled={busy}>
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              {avatarUrl ? 'Change photo' : 'Add a photo'}
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>

      <ActionSheet
        visible={chooserOpen}
        title="Profile photo"
        onClose={() => setChooserOpen(false)}
        actions={[
          { label: 'Take photo', icon: 'photo-camera', onPress: () => pick('camera') },
          { label: 'Choose from gallery', icon: 'photo-library', onPress: () => pick('library') },
          ...(avatarUrl
            ? [
                {
                  label: 'Remove photo',
                  icon: 'delete-outline' as const,
                  destructive: true,
                  onPress: remove,
                },
              ]
            : []),
        ]}
      />
    </ThemedView>
  );
}

const AVATAR = 128;

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    alignItems: 'center',
    paddingTop: Spacing.six,
    gap: Spacing.two,
  },
  avatarWrap: {
    width: AVATAR,
    height: AVATAR,
    marginBottom: Spacing.two,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: 999,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: '#ffffff',
    fontSize: 52,
    fontWeight: '800',
  },
  editBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#00000022',
  },
  avatarBusy: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 24,
    lineHeight: 30,
  },
  changeBtn: {
    marginTop: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
