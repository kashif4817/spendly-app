/**
 * User profile: name/email row in `public.profiles` (so you can browse your
 * users in Supabase) + an avatar image in the private `avatars` bucket.
 * No passwords are ever stored here — Supabase Auth handles those, hashed.
 */

import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '@/lib/supabase';

const BUCKET = 'avatars';

/** Create/refresh the profile row for an account. Best-effort. */
export async function upsertProfile(id: string, email: string | null, name: string | null): Promise<void> {
  await supabase.from('profiles').upsert({
    id,
    email,
    name,
    updated_at: new Date().toISOString(),
  });
}

export async function getAvatarPath(id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('avatar_path')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return (data.avatar_path as string | null) ?? null;
}

/** Upload a compressed avatar to avatars/{userId}/avatar.jpg and save its path. */
export async function uploadAvatar(userId: string, uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const path = `${userId}/avatar.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;

  await supabase
    .from('profiles')
    .update({ avatar_path: path, updated_at: new Date().toISOString() })
    .eq('id', userId);
  return path;
}

export async function avatarUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return error || !data ? null : data.signedUrl;
}

export async function removeAvatar(userId: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([`${userId}/avatar.jpg`]);
  await supabase
    .from('profiles')
    .update({ avatar_path: null, updated_at: new Date().toISOString() })
    .eq('id', userId);
}
