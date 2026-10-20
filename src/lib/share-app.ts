/**
 * Passing Spendly on.
 *
 * The link points at `releases/latest`, which GitHub resolves itself, so it
 * keeps serving the newest APK without anyone editing it after a release. The
 * repo and file name come from `expo.extra.release` — the same place the
 * release script and the update check read them from.
 */

import Constants from 'expo-constants';
import { Share } from 'react-native';

import { notify } from '@/lib/confirm';

type ReleaseConfig = { repo?: string; apk?: string };

const release: ReleaseConfig = Constants.expoConfig?.extra?.release ?? {};

/** The link that always serves the newest APK, or null if none is configured. */
export const DOWNLOAD_URL =
  release.repo && release.apk
    ? `https://github.com/${release.repo}/releases/latest/download/${release.apk}`
    : null;

/** Opens the system share sheet with the download link. */
export async function shareApp(): Promise<void> {
  if (!DOWNLOAD_URL) {
    notify('No download link', 'This build has no release repository configured.');
    return;
  }
  try {
    await Share.share({
      message: `Spendly — a simple expense and loan tracker.\n\nDownload the latest version: ${DOWNLOAD_URL}`,
    });
  } catch {
    // The sheet was dismissed — nothing to report.
  }
}
