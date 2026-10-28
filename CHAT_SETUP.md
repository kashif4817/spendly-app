# Shared-book chat — setup

The chat lives inside a shared book: the two people in a book get one thread,
and a message can quote one entry from that book's statement so both sides are
looking at the same row rather than two similar ones.

Two things have to be switched on for it, in this order.

---

## 1. Run the SQL (required)

Supabase Dashboard → SQL Editor → New query → paste → Run:

```
supabase/shared-chat.sql
```

Safe to re-run, and **re-running it is how you upgrade**: columns added after
the first release (`shared_messages.deleted_at`, `shared_reads.delivered_at` —
the retracted-message line and the second tick) are applied with
`add column if not exists`, so an existing project picks them up without
losing a message.

Run it **after** `shared-books.sql`, which it depends on — it reuses that
file's `is_book_member()` for every policy, and `profiles.set_updated_at()`
for its triggers.

It creates three tables:

| Table | What it holds |
| --- | --- |
| `shared_messages` | The thread. One row per message, scoped to a book. |
| `shared_reads` | How far each member has received and read — two timestamps per (book, member). |
| `push_tokens` | Where to reach a member whose app isn't running. |

…plus the RLS policies (members read the thread, only the sender can change
their own message, push tokens are own-row only), the realtime publication
entries, and the trigger that sends a push when a message is inserted.

**After this step the chat works**: messages sync like entries do, arrive live
over the realtime socket while both apps are open, and show an unread badge
when they aren't. Everything below is about being notified while the app is
closed.

### If you skip the push part

Nothing breaks. `push_tokens` just stays empty, the trigger finds nobody to
notify and returns, and messages still arrive on the next pull or the next time
the socket connects. The app is designed around that: a token is how it gets
louder, never how it works.

---

## 2. Android push credentials (needed for notifications while the app is closed)

A push to an Android device goes through Firebase Cloud Messaging, so the build
needs FCM credentials. This is a **build-time** change — it cannot ship over
the air.

1. In the [Firebase console](https://console.firebase.google.com), use (or
   create) a project, add an Android app with package name
   `com.codeflyx.expensetracker`, and download `google-services.json`.
2. Put the file at the repo root and point `app.json` at it:

   ```json
   "android": {
     "package": "com.codeflyx.expensetracker",
     "googleServicesFile": "./google-services.json"
   }
   ```

   Keep it out of git (`.gitignore`) and upload it to EAS instead:
   `eas secret:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json`
   then set `"googleServicesFile": "$GOOGLE_SERVICES_JSON"`.
3. In Firebase → Project settings → Service accounts, generate a private key,
   then give it to EAS:
   `eas credentials` → Android → *FCM V1 service account key* → upload the JSON.
4. Rebuild and install:
   `eas build --platform android --profile preview`

A new build is required for one more reason: this change added the
`expo-notifications` config plugin to `app.json` (for the notification icon and
accent colour). Config plugins are native, so the icon only changes in a fresh
build — the chat itself ships over the air.

---

## How delivery actually works

Three paths, because no single one covers every state the app can be in:

| App state | What delivers the message |
| --- | --- |
| Open, thread on screen | Realtime socket. No notification — you're watching it arrive. |
| Open, elsewhere in the app | Realtime socket, plus a local notification raised by the app. |
| Backgrounded or closed | Push from the server's insert trigger. |
| Was offline, now back | The ordinary shared-table pull. |

A message that arrives twice (socket *and* push, which can race in the
foreground) is shown once: both carry the same message id and the second is
dropped. See `src/lib/notifications.ts`.

Permission is asked for once, on sign-in, by `registerPushToken()`. Declining
it leaves the thread and the unread badges working.

---

## Checking it

1. Sign in on two devices with two different Google accounts.
2. Create a shared book on one, join it with the code on the other.
3. Open the book → the chat icon beside **Refresh** in the header.
4. Send a message with both apps open: it should appear on the other device in
   under a second, with a single tick turning to a double tick once the other
   side opens the thread.
5. Attach an entry (the receipt button in the composer) and send: the other
   device shows the same quote, and tapping it opens that entry.
6. Background the second app and send again: a notification should arrive, and
   tapping it should open the thread.

If step 6 does nothing, step 2 above is almost always the reason — check that
`push_tokens` has a row for the receiving account:

```sql
select user_id, platform, updated_at from public.push_tokens where not deleted;
```

An empty table means the device never got a token (no permission, a simulator,
or no FCM credentials in the build). A row that exists while notifications
still don't arrive points at the credentials in step 2.3.
