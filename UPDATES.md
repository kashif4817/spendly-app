# Live Updates (EAS Update / OTA)

Push code changes to the installed app **without uninstall/reinstall**.

## The rule of thumb

| You changed... | What to run |
| --- | --- |
| JS / TSX / styles / screens (99% of edits) | `eas update` → app pulls it on next launch ✅ |
| A **native** module (new `expo-*` with native code), `app.json`, `eas.json`, or `package.json` deps/scripts | `eas build` once, reinstall the APK |

The `runtimeVersion: fingerprint` policy auto-detects the second case: it hashes
everything that affects the native runtime, so a native change produces a new
runtime version and the update simply won't be offered to old builds.

Because the version is fingerprinted rather than read from `expo.version`,
**bumping `version` in `app.json` is safe** and does not break OTA.

## One-time setup + first build

```bash
npm install --global eas-cli     # if not installed
eas login                        # account: codeflyx  (NOT kashif4817)
eas build --platform android --profile preview
```

Install the resulting **APK** on your phone (from the QR/link EAS gives you).
That's the only manual install — until a native change.

> The update URL is compiled into the binary. An APK built before OTA was
> configured can never receive updates, no matter how many times you publish.

## Push an update (every time after that)

```bash
eas update --channel production --message "what changed"
```

Background the app → reopen → the `UpdatePrompt` banner appears → tap **Restart**.
If it's ignored, the update applies on the next cold start anyway.

## What's already wired up

- `expo-updates` (`~29.0.18`) installed.
- `app.json` → `owner: codeflyx`, `runtimeVersion` (fingerprint), `updates.url`
  (project `6ac93557…`), `checkAutomatically: ON_LOAD`,
  `fallbackToCacheTimeout: 0` (never block startup on the network),
  Android `package` `com.codeflyx.expensetracker`.
- `eas.json` → `development` / `preview` / `production` profiles.
  **`preview` (APK) and `production` (AAB) both publish on the `production`
  channel**, so one `eas update` reaches sideloaded and store installs alike.
  `development` has its own channel.
- `src/components/update-prompt.tsx` → the banner, mounted once in
  `src/app/_layout.tsx`. It never auto-restarts (a reload mid-entry would lose
  what you're typing) and re-checks whenever the app is foregrounded.

No need to run `eas update:configure` — the config is set.

## Notes

- OTA updates run only on an **EAS build**, not in Expo Go or dev builds
  (the banner is `__DEV__`-guarded).
- The channel is baked into the build. The APK from the `preview` profile
  listens on `production`, so publish with `--channel production`.
- For live coding at home instead of OTA: build the `development` profile once,
  then `npx expo start` and save files to reload instantly over WiFi.

## Troubleshooting

Check in this order:

1. **Is the device running an APK built *after* OTA was configured?** #1 cause.
2. **Wrong Expo login?** `eas whoami` must print `codeflyx`. An
   `Entity not authorized` error means the wrong account — fix with `eas login`,
   never by editing `app.json`, and **never** by running `eas init` (that mints a
   duplicate project and orphans every installed APK).
3. **Did the app get backgrounded and reopened?** It checks on launch and on
   foreground, not while sitting idle on screen.
4. **Runtime version mismatch?** `eas fingerprint:compare` — did a native dep,
   `app.json`, or a `package.json` script change since the build?
5. **Testing in Expo Go / dev?** OTA never runs there.

### It fails silently by design

`update-prompt.tsx` swallows errors so a network blip never shows the user a
crash. When debugging, temporarily log inside the `catch` — otherwise a
misconfiguration looks identical to "no update available".
