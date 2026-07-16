# Spendly

A simple offline-first expense tracker built with [Expo](https://expo.dev) and
Expo Router. Income and expenses are stored locally on the device with SQLite —
no account, no server, no network required.

## Features

- Log income and expenses against categories
- Running balance, plus monthly reports and a bar chart breakdown
- Full transaction history
- Light and dark theme, following the system setting
- Over-the-air updates, so fixes arrive without a reinstall

## Tech

| | |
| --- | --- |
| Framework | Expo SDK 54, React Native 0.81 |
| Routing | Expo Router (typed routes) |
| Storage | `expo-sqlite`, migrations run on first import |
| Updates | `expo-updates` (EAS Update) |
| Language | TypeScript |

## Get started

```bash
npm install
npx expo start
```

Then open the app in Expo Go, an emulator, or a development build.

> Expo is pinned to **SDK 54** deliberately — the Play Store build of Expo Go
> must support the SDK for the plain `npx expo start` workflow to keep working.

## Project layout

```
src/
  app/            file-based routes
    (tabs)/       home, reports, history
    entry.tsx     add-entry modal
    _layout.tsx   root layout
  components/     UI building blocks
  db/             SQLite setup, migrations, hooks
  constants/      theme, categories, app settings
  lib/            date and money helpers
```

To change the currency, edit `CURRENCY` in `src/constants/app.ts` — it's used
everywhere money is displayed.

## Builds and updates

```bash
eas build --platform android --profile preview   # sideloadable APK
eas update --channel production -m "what changed" # ship JS changes over the air
```

See [UPDATES.md](UPDATES.md) for the full OTA setup, the rules about what can
and can't ship over the air, and troubleshooting.
