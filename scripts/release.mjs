#!/usr/bin/env node
/**
 * Build the Android APK on EAS and publish it as a GitHub release, so it can be
 * downloaded from a link that never expires (EAS's own links last 30 days).
 *
 *   npm run release -- --notes "What changed"
 *   npm run release -- --build-id <id>    # publish an EAS build that already finished
 *
 * Every release is a new native build, so it needs a new "version" in app.json.
 * That version is also the OTA runtime (runtimeVersion policy "appVersion") and
 * what the app compares against to show its update icon — so the script refuses
 * to publish the same version twice.
 *
 * Needs: eas-cli logged in as the project owner, and the GitHub CLI (`gh`)
 * logged in with access to the repo.
 */

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { notes: '', buildId: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--notes') args.notes = argv[++i] ?? '';
    else if (arg === '--build-id') args.buildId = argv[++i] ?? '';
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run release -- [--notes "What changed"] [--build-id <eas build id>]');
      process.exit(0);
    } else fail(`Unknown option: ${arg}`);
  }
  return args;
}

/**
 * Run a CLI. eas is a .cmd shim on Windows, which Node only spawns through a
 * shell; none of the arguments passed here contain spaces, so that's safe.
 */
function run(cmd, args, { capture = false, quiet = false, shell = false } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    shell,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // Captured runs keep stderr on screen so EAS progress stays visible;
    // quiet runs are yes/no checks whose output would only confuse.
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) fail(`Couldn't run ${cmd}: ${result.error.message}`);
  return result;
}

/** EAS prints one JSON value on stdout in --json mode; tolerate stray lines around it. */
function parseJson(stdout, what) {
  const start = stdout.search(/[[{]/);
  if (start === -1) fail(`EAS didn't return any JSON for ${what}.`);
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    fail(`Couldn't read EAS's answer for ${what}.`);
  }
}

const args = parseArgs(process.argv.slice(2));

// 1. What are we releasing?
const appJson = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8'));
const version = appJson.expo?.version;
const { repo, apk } = appJson.expo?.extra?.release ?? {};
if (!version) fail('app.json has no expo.version.');
if (!repo || !apk) fail('app.json is missing expo.extra.release { repo, apk }.');
const tag = `v${version}`;

// 2. GitHub CLI ready, and this version not already out?
if (run('gh', ['auth', 'status'], { quiet: true }).status !== 0) {
  fail('The GitHub CLI isn\'t logged in. Run "gh auth login" first.');
}
if (run('gh', ['release', 'view', tag, '--repo', repo], { quiet: true }).status === 0) {
  fail(
    `${tag} is already released. Bump "version" in app.json (for example to the next patch)\n` +
      '  — every APK needs a new version, or phones won\'t see it as an update.'
  );
}

// 3. Build (or look up an existing build).
console.log(args.buildId ? `\n→ Looking up EAS build ${args.buildId}…` : `\n→ Building Spendly ${version} on EAS (this takes a while)…`);
const easArgs = args.buildId
  ? ['build:view', args.buildId, '--json']
  : ['build', '--platform', 'android', '--profile', 'preview', '--non-interactive', '--wait', '--json'];
const easResult = run('eas', easArgs, { capture: true, shell: isWindows });
if (easResult.status !== 0) fail('The EAS build failed. See the log above.');

const parsed = parseJson(easResult.stdout, 'the build');
const build = Array.isArray(parsed) ? parsed.find((b) => b.platform === 'ANDROID') : parsed;
if (!build) fail('EAS returned no Android build.');
if (build.status !== 'FINISHED') fail(`The build isn't finished (status: ${build.status}).`);
const apkUrl = build.artifacts?.buildUrl ?? build.artifacts?.applicationArchiveUrl;
if (!apkUrl || !/\.apk(\?|$)/i.test(apkUrl)) fail('The build has no APK. Is the preview profile still set to "apk"?');
if (build.appVersion && build.appVersion !== version) {
  fail(`That build is version ${build.appVersion}, but app.json says ${version}.`);
}

// 4. Download the APK under its fixed name — the "latest" link depends on it.
console.log('\n→ Downloading the APK…');
const response = await fetch(apkUrl);
if (!response.ok) fail(`Download failed (${response.status}).`);
const dir = path.join(os.tmpdir(), 'spendly-release');
mkdirSync(dir, { recursive: true });
const apkPath = path.join(dir, apk);
writeFileSync(apkPath, Buffer.from(await response.arrayBuffer()));

// 5. Publish. Notes go through a file so quotes and spaces survive every shell.
const buildNumber = build.appBuildVersion ? ` (build ${build.appBuildVersion})` : '';
const notes = [
  args.notes.trim() || 'Bug fixes and improvements.',
  '',
  `Spendly ${version}${buildNumber}.`,
  'Download Spendly.apk, open it and tap Update. It installs over the app you have and keeps your data.',
].join('\n');
const notesPath = path.join(dir, 'notes.md');
writeFileSync(notesPath, notes);

console.log(`\n→ Publishing ${tag} to github.com/${repo}…`);
const publish = run('gh', [
  'release', 'create', tag, apkPath,
  '--repo', repo,
  '--title', `Spendly ${version}`,
  '--notes-file', notesPath,
  '--latest',
]);
if (publish.status !== 0) fail('Publishing the GitHub release failed.');

console.log(`
✔ Spendly ${version} is out.

  Always the newest APK (share this one — it never changes):
  https://github.com/${repo}/releases/latest/download/${apk}

  This version only:
  https://github.com/${repo}/releases/download/${tag}/${apk}

Phones on an older version will show the update icon on the dashboard.
`);
