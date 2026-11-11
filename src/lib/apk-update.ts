/**
 * Download a new APK inside the app, check it arrived intact, then hand it to
 * Android's installer.
 *
 * WHY NOT JUST OPEN THE LINK IN THE BROWSER, as the update button used to: a
 * phone's browser once handed over a 125 MB APK with a 10 MB run of zeros in
 * the middle — the right size, so it looked finished, but damaged inside.
 * Android read the name and icon from it and then refused it with nothing
 * more than "App not installed", which reads as a broken release rather than
 * a broken download. Here the file is checked against the size GitHub reports
 * and the MD5 the release publishes (lib/app-release.ts) BEFORE the installer
 * ever sees it, and a damaged one is fetched again.
 *
 * Android only, like the release check itself. Needs the
 * REQUEST_INSTALL_PACKAGES permission (app.json); the first time, Android asks
 * the user to allow Spendly to install apps, then carries on.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

import type { AppRelease } from '@/lib/app-release';

export type UpdateStep =
  /** `fraction` is null while the size isn't known yet. */
  | { kind: 'downloading'; fraction: number | null }
  | { kind: 'checking' }
  | { kind: 'installing' };

/** Raised with a message the update sheet can show as-is. */
export class UpdateError extends Error {}

/** One folder, emptied before every download, so old APKs never pile up. */
const FOLDER = `${FileSystem.cacheDirectory}updates/`;

/** A damaged download is fetched once more before giving up. */
const ATTEMPTS = 2;

/** Intent.FLAG_GRANT_READ_URI_PERMISSION — lets the installer read our file. */
const GRANT_READ = 0x1;
const APK_TYPE = 'application/vnd.android.package-archive';

let active: { task: FileSystem.DownloadResumable; cancelled: boolean } | null = null;

/** Stop a download in progress (the sheet was closed). Safe to call any time. */
export async function cancelUpdateDownload(): Promise<void> {
  const running = active;
  active = null;
  if (!running) return;
  running.cancelled = true;
  await running.task.cancelAsync().catch(() => {});
}

/**
 * Fetch the release's APK, verify it, and open the installer.
 *
 * Resolves 'installer' once Android's installer has been shown (it resolves
 * again when the user comes back, if they do), or 'cancelled' when the
 * download was stopped. Throws an UpdateError for anything the user should
 * hear about.
 */
export async function downloadAndInstall(
  release: AppRelease,
  onStep: (step: UpdateStep) => void
): Promise<'installer' | 'cancelled'> {
  await FileSystem.deleteAsync(FOLDER, { idempotent: true });
  await FileSystem.makeDirectoryAsync(FOLDER, { intermediates: true });
  const file = `${FOLDER}Spendly-${release.version}.apk`;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    onStep({ kind: 'downloading', fraction: release.size ? 0 : null });

    const task = FileSystem.createDownloadResumable(
      release.downloadUrl,
      file,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : (release.size ?? 0);
        onStep({
          kind: 'downloading',
          fraction: total > 0 ? Math.min(totalBytesWritten / total, 1) : null,
        });
      }
    );
    const running = { task, cancelled: false };
    active = running;

    let result: FileSystem.FileSystemDownloadResult | undefined;
    try {
      result = await task.downloadAsync();
    } catch {
      if (running.cancelled) return 'cancelled';
      throw new UpdateError('The download stopped. Check your connection and try again.');
    } finally {
      if (active === running) active = null;
    }
    if (running.cancelled || !result) return 'cancelled';
    if (result.status < 200 || result.status >= 300) {
      throw new UpdateError('GitHub didn’t send the update. Try again in a minute.');
    }

    onStep({ kind: 'checking' });
    if (await isIntact(file, release)) {
      onStep({ kind: 'installing' });
      await openInstaller(file);
      return 'installer';
    }
    // Damaged on the way. Never show it to the installer — fetch it again.
    await FileSystem.deleteAsync(file, { idempotent: true });
  }

  throw new UpdateError(
    'The download arrived damaged twice. Try again on Wi-Fi, or download it in your browser.'
  );
}

/**
 * The file is exactly the size GitHub reports and, when the release publishes
 * one, has the same MD5. Hashed natively, so a 70 MB file is quick and never
 * held in memory.
 */
async function isIntact(file: string, release: AppRelease): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(file, { md5: !!release.md5 });
  if (!info.exists) return false;
  if (release.size && info.size !== release.size) return false;
  if (release.md5 && info.md5?.toLowerCase() !== release.md5) return false;
  return true;
}

async function openInstaller(file: string): Promise<void> {
  try {
    // A content:// uri through Expo's FileProvider: Android won't hand an app
    // another app's file:// path, and the installer runs as its own app.
    const uri = await FileSystem.getContentUriAsync(file);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: uri,
      flags: GRANT_READ,
      type: APK_TYPE,
    });
  } catch {
    throw new UpdateError('Couldn’t open Android’s installer. Download it in your browser instead.');
  }
}
