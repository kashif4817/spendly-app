# "Continue with Google" — one-time setup

The app now signs in **only** with Google (no passwords). The code is done — you
just need to create the Google credentials and paste one value in three places.

Fill in this value everywhere it appears below:

```
WEB_CLIENT_ID = ____________________________.apps.googleusercontent.com
```

---

## 1. Google Cloud Console — create OAuth clients
<https://console.cloud.google.com/> → create (or pick) a project.

1. **APIs & Services → OAuth consent screen**
   - User type: **External**. App name: *Spendly*. Add your email as support + developer contact.
   - Add yourself under **Test users** (so sign-in works before the app is verified).

2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - **A) Web application** → name it "Spendly Web".
     - This is the one you paste as `WEB_CLIENT_ID` below. Copy the **Client ID** *and* **Client secret** (Supabase needs both).
   - **B) Android** → name it "Spendly Android".
     - Package name: `com.codeflyx.expensetracker`
     - SHA-1: get it from EAS (next step). You can create this client now and add the SHA-1 after.

## 2. Get your app's SHA-1 (from the EAS keystore)
```
eas credentials
```
→ choose **Android** → **production** (or the profile you build) → **Keystore** →
it prints **SHA1 Fingerprint**. Paste that into the Android OAuth client (step 1B).

> The SHA-1 must match the keystore that signs the APK you install. Use the same
> build profile you distribute with.

## 3. Supabase — enable Google
Supabase Dashboard → **Authentication → Providers → Google** → Enable, then paste:
- **Client ID** = the **Web** client ID (WEB_CLIENT_ID)
- **Client secret** = the **Web** client secret

Save.

## 4. Put the Web client ID in the app
- **Local (`.env.local`)** — already has an empty line:
  ```
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=WEB_CLIENT_ID
  ```
- **EAS (for builds)** — same as you did for Supabase:
  ```
  eas env:create --environment production --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value "WEB_CLIENT_ID" --visibility plaintext
  ```

## 5. Rebuild (Google sign-in is a native module)
```
eas build --platform android --profile preview
```
Install the new APK. Tap **Continue with Google** — done. Name + profile photo
come from the Google account automatically.

---

### Notes
- **Not testable in Expo Go** — Google sign-in needs a dev/preview/production build.
- **iOS later:** add an iOS OAuth client and put its reversed client ID as
  `iosUrlScheme` in the `@react-native-google-signin/google-signin` plugin config
  in `app.json`. Not needed for Android.
- **Existing email/password test accounts** won't carry over — everyone signs in
  fresh with Google (their data starts clean unless it was already synced under
  the same Supabase user).
- **DB SQL still required** (unchanged): run `schema.sql`, `receipts.sql`,
  `ledger.sql`, and `profiles.sql` in Supabase.
