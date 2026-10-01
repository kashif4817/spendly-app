# Releases and live updates

Spendly isn't on the Play Store. It's installed from an APK on GitHub, and it
gets changes in one of two ways:

| You changed... | What to run | What phones do |
| --- | --- | --- |
| JS / TSX / styles / screens (most edits) | `eas update` | Pick it up on next launch. Nothing to install. |
| Anything native: a new `expo-*` package with native code, the icon, splash, app name, permissions, or other `app.json` settings | Bump `version`, then `npm run release` | Show an **update icon** on the dashboard. Tap it, download, install over the old app. |

Never uninstall to update. A new APK installs straight over the old one and keeps
all local data, as long as it comes from the same `preview` profile, which is
signed with the same key.

## Versions are the runtime

`app.json` uses `"runtimeVersion": { "policy": "appVersion" }`, so the OTA runtime
**is** `expo.version`:

- `eas update` only reaches phones running a build of the **same version**.
- A new native build therefore **must** get a new version (1.1.0 → 1.1.1 or
  1.2.0). Otherwise a JS update meant for the new build would also land on old
  builds that lack its native code, and crash them.
- `npm run release` refuses to publish a version that's already released.

Build numbers (Android `versionCode`) are handled by EAS: `eas.json` has
`appVersionSource: "remote"` and `autoIncrement` on the `preview` profile, so
every APK is a proper upgrade of the last one.

## Release a new APK

1. Bump `version` in `app.json`.
2. Run:

   ```bash
   npm run release -- --notes "What's new in this version"
   ```

   This builds the APK on EAS (`preview` profile), downloads it, and publishes it
   as a GitHub release on `kashif4817/spendly-app` with the file name `Spendly.apk`.

3. Share this link. It never changes and always serves the newest APK:

   ```
   https://github.com/kashif4817/spendly-app/releases/latest/download/Spendly.apk
   ```

Already have a finished EAS build? Publish it without rebuilding:
`npm run release -- --build-id <id>`.

Needs: `eas login` as **codeflyx** and `gh auth login` as **kashif4817**.

### The update icon

`src/lib/app-release.ts` asks GitHub for the latest release (on launch and when
the app comes to the front, at most every 30 minutes) and compares its version
with the installed one. When a newer version exists, `AppUpdateButton` shows next
to the profile picture on the dashboard and stays there until that version is
installed. The answer is cached, so it keeps showing offline. The repo and APK
name come from `expo.extra.release` in `app.json`, the same place the release
script reads them from.

## Push a JS update

```bash
eas update --channel production --message "what changed"
```

Background the app, reopen it, and the `UpdatePrompt` banner appears. Tap
**Restart**. If it's ignored, the update applies on the next cold start anyway.

## What's wired up

- `expo-updates` installed. `app.json` has `owner: codeflyx`, `runtimeVersion`
  (appVersion), `updates.url` (project `6ac93557…`), `checkAutomatically: ON_LOAD`,
  `fallbackToCacheTimeout: 0` (never block startup on the network), and Android
  `package` `com.codeflyx.expensetracker`.
- `eas.json` has `development` / `preview` / `production` profiles. `preview`
  (APK) and `production` (AAB) both listen on the `production` channel;
  `development` has its own.
- `src/components/update-prompt.tsx` is the OTA banner. It never auto-restarts (a
  reload mid-entry would lose what you're typing) and re-checks on foreground.
- `scripts/release.mjs` is the build-and-publish command behind `npm run release`.

## Notes

- OTA updates run only on an **EAS build**, not in Expo Go or dev builds.
- The channel is baked into the build. The `preview` APK listens on `production`,
  so publish with `--channel production`.
- For live coding at home: build the `development` profile once, then
  `npx expo start` and save files to reload over WiFi.

## Troubleshooting

1. **Update not arriving?** Check the phone runs the same `version` as `app.json`
   (Settings shows it at the bottom). A different version means a different
   runtime, so install the latest APK first.
2. **Wrong Expo login?** `eas whoami` must print `codeflyx`. An
   `Entity not authorized` error means the wrong account. Fix it with `eas login`,
   never by editing `app.json`, and **never** by running `eas init` (that mints a
   duplicate project and orphans every installed APK).
3. **"App not installed" when installing an APK?** It was signed with a different
   key, for example a `development` build or one built locally. Use APKs from
   `npm run release` only.
4. **Did the app get backgrounded and reopened?** Both the OTA check and the
   update-icon check run on launch and on foreground, not while idle.

`update-prompt.tsx` and `app-release.ts` swallow errors on purpose, so a network
blip never looks like a crash. When debugging, log inside their `catch` blocks.
