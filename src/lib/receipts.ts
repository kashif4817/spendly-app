/**
 * Receipt images for transactions. Photos are resized + compressed hard on the
 * device (≈50–150 KB each), then stored in a private Supabase Storage bucket at
 * `{userId}/{transactionId}.jpg`. Uploads are capped per user by a quota so one
 * account can't fill the bucket.
 */

import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

const BUCKET = 'receipts';

/** Per-user storage cap for receipts. */
export const RECEIPT_QUOTA_BYTES = 100 * 1024 * 1024; // 100 MB

export type PickedReceipt = { uri: string; size: number };

/** Distinguishes "you're over quota" from "upload failed / offline". */
export class ReceiptError extends Error {
  constructor(public code: 'quota' | 'failed') {
    super(code);
    this.name = 'ReceiptError';
  }
}

/** Pick an image from the gallery. Returns the raw uri, or null if cancelled. */
export async function pickFromLibrary(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  return res.canceled ? null : res.assets[0]?.uri ?? null;
}

/** Take a photo. Returns the raw uri, or null if cancelled / permission denied. */
export async function captureWithCamera(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchCameraAsync({ quality: 1 });
  return res.canceled ? null : res.assets[0]?.uri ?? null;
}

/** Resize + compress to a small JPEG. Returns the new uri and its byte size. */
export async function compressReceipt(uri: string): Promise<PickedReceipt> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 1280 });
  const image = await context.renderAsync();
  const out = await image.saveAsync({ compress: 0.5, format: SaveFormat.JPEG });
  const info = await FileSystem.getInfoAsync(out.uri);
  return { uri: out.uri, size: info.exists ? info.size : 0 };
}

async function usageBytes(userId: string): Promise<number> {
  const { data, error } = await supabase.storage.from(BUCKET).list(userId, { limit: 1000 });
  if (error || !data) return 0;
  return data.reduce((sum, f) => sum + (f.metadata?.size ?? 0), 0);
}

/** Upload to {userId}/{txId}.jpg, enforcing the per-user quota. Throws ReceiptError. */
export async function uploadReceipt(
  userId: string,
  txId: string,
  receipt: PickedReceipt
): Promise<string> {
  if ((await usageBytes(userId)) + receipt.size > RECEIPT_QUOTA_BYTES) {
    throw new ReceiptError('quota');
  }

  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(receipt.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    throw new ReceiptError('failed');
  }

  const path = `${userId}/${txId}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, decode(base64), { contentType: 'image/jpeg', upsert: true });
  if (error) throw new ReceiptError('failed');
  return path;
}

/** A short-lived signed URL for displaying a stored receipt. */
export async function receiptUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return error || !data ? null : data.signedUrl;
}

export async function deleteReceipt(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}
