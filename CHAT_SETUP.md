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

Safe to re-run, and **re-running it is how you upgrade.** Everything added
after the first release is applied with `add column if not exists` /
`create table if not exists`, so an existing project picks it up without
losing a message:

| Added | What it is for |
| --- | --- |
| `shared_messages.deleted_at` | The line left behind by a retracted message. |
| `shared_reads.delivered_at` | The second tick. |
| `shared_messages.reply_to` | Swipe-to-reply. |
| `shared_messages.expires_at` | Timed disappearing messages — stamped per message as it is sent. |
| `shared_books.expire_after` | How long this book's messages live, in seconds; 0 is off. |
| `shared_reactions` | Tap-backs. One row per (message, person). |
| `shared_messages.edited_at` | When the sender last corrected the words. |
| `shared_messages.vanish_at` | Sent into a vanishing session — no clock, clears when either of you leaves the thread. |
| `shared_books.pinned_message` | The one message held at the top of the thread. |
| `shared_books.vanish_state` | `''` off, `ask:<uuid>` invited, `on` running. |

Until it has been run, an app update that uses them keeps its messages
**queued** rather than losing them: the push sees a column the server has
never heard of, leaves the row in the outbox, and uploads it the moment the
SQL lands. Reactions behave the same way — a missing table is skipped by the
pull rather than failing it, so nothing else stops syncing meanwhile.

Run it **after** `shared-books.sql`, which it depends on — it reuses that
file's `is_book_member()` for every policy, and `profiles.set_updated_at()`
for its triggers.

It creates four tables:

| Table | What it holds |
| --- | --- |
| `shared_messages` | The thread. One row per message, scoped to a book. |
| `shared_reactions` | Tap-backs. One row per (message, person), so re-reacting replaces rather than stacks. |
| `shared_reads` | How far each member has received and read — two timestamps per (book, member). |
| `push_tokens` | Where to reach a member whose app isn't running. |

Reactions are a table of their own rather than a column on the message on
purpose: the whole point is reacting to what the **other** person said, and
the message policy deliberately lets nobody but the sender touch their own
row. You own your reaction, they own their message, and neither policy has to
be loosened.

Typing indicators need **no SQL at all**. They go over Realtime broadcast on a
channel named after the book's id — nothing is stored, nothing is replayed,
and the only thing on the wire is "someone is typing".

Nor do the device-local features: muting a chat, starring messages and unsent
drafts all live in AsyncStorage on the one phone. None of them is a fact about
the conversation, so none of them is the other person's business.

### Two kinds of disappearing

| | Set by | Clock | Ends when |
| --- | --- | --- | --- |
| **Disappearing messages** | Either member, from the menu | 24h / 7d / 30d | The stamp on each message is reached |
| **Vanishing chat** | One invites, the other accepts | None | Either of you leaves the thread |

They are deliberately separate. The first is a retention policy; the second is
a mode you are both in for as long as you are both looking at it. A vanishing
message carries `vanish_at` and is never previewed in a push notification,
never forwarded, never pinned and never exported.

…plus the RLS policies (members read the thread, only the sender can change
their own message, push tokens are own-row only) and the realtime publication
entries.

**After this step the chat works**: messages sync like entries do, arrive live
over the realtime socket while both apps are open, and show an unread badge
when they aren't. Everything below is about being notified while the app is
closed.

### Then run `supabase/notifications.sql`

Every push the app sends comes from this one file — run it after
`shared-chat.sql`, and re-run it to upgrade. It notifies the **other** member
of a shared book (never whoever did it):

| Event | When | Android channel | Tap opens |
| --- | --- | --- | --- |
| `message` | A chat message | Shared book chat | The chat |
| `reminder` | A balance reminder ("💰 Kashif sent a balance reminder") | Shared book chat | The chat |
| `reaction` | A reaction to a message **you** sent | Shared book chat | The chat |
| `entry_added` | An entry added — directly or by a split — or a deleted one restored | Shared book activity | The book |
| `entry_edited` | Amount, note, day or payer changed (a reorder doesn't count) | Shared book activity | The book |
| `entry_deleted` | An entry deleted | Shared book activity | The book |
| `joined` | Someone joined the book | Shared book activity | The book |

Each phone can switch any of these off (Settings → Notifications) or mute a
whole book (its ⋮ menu). Both are stored on that phone's own `push_tokens` row
(`off_events`, `muted_books`), because with the app closed Android shows a push
without asking the app — the server has to know. The row is own-row only, so
the other member never sees what you silenced.

Until it has been run, a balance reminder still sends — just as an ordinary
message — and pushes go out without the per-phone filtering.

### Then run `supabase/entry-safety.sql`

The safety layer for shared entries. Run it after `notifications.sql` (and
re-run that one first if you changed it); it is safe to re-run.

- **24-hour lock.** For 24 hours after the server receives an entry, its author
  can edit or delete it freely. After that the database refuses, and the
  author sends a request instead — the exact new values, or a delete — which
  the other member approves or turns down. Requests expire after 7 days. The
  clock is the server's `posted_at`, never the phone's.
- **Activity log** (`shared_entry_log`). A trigger records every edit, delete
  and restore, and every entry added for an earlier day than it was added on
  (Pakistan time) — a back-dated entry: who,
  when, before and after, and who approved it. Both members read it; nobody can
  write to it. It starts empty — changes before the file was run aren't known.
- **Checks.** An entry's book, author and creation time can't change; whoever
  paid must be in the book; amounts must be above zero; dates must be real;
  notes are capped at 1,000 characters; someone who left can't edit.

| Event | When | Android channel | Tap opens |
| --- | --- | --- | --- |
| `approval` | The other member asks to change or delete one of their entries | Shared book activity | The request |
| `approval_result` | Your request was approved or turned down | Shared book activity | The request |

These two ignore mute and the switches: a request nobody hears about is an
entry frozen for a week.

**Run it once both phones have the app version that knows about requests.**
An older app that edits a locked entry is refused, and its edit sits in its
outbox. The current app turns such a refusal into a request by itself.

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

**Status: done.** Firebase project `spendly-c9d83`, FCM API (V1) enabled.

1. In the [Firebase console](https://console.firebase.google.com), the project
   has an Android app with package name `com.codeflyx.expensetracker`. Its
   `google-services.json` is at the repo root and `app.json` points at it:

   ```json
   "android": {
     "package": "com.codeflyx.expensetracker",
     "googleServicesFile": "./google-services.json"
   }
   ```

   **It is committed on purpose.** It holds public identifiers only (Expo's
   docs say so), it ends up inside every APK anyway, and EAS Build only bakes
   in files it can see. Don't move it to an env var: `$VAR` interpolation does
   not work in a static `app.json`.
2. The **service-account key** is different: it's a private key. Generate it
   in Firebase → Project settings → Service accounts → *Generate new private
   key*, then upload it to EAS (either way works):
   - `eas credentials` → Android → production → Google Service Account →
     *Manage your Google Service Account Key for Push Notifications (FCM V1)* →
     *Set up…* → *Upload a new service account key*, or
   - expo.dev → project → Project settings → Credentials → Android →
     `com.codeflyx.expensetracker` → *FCM V1 service account key* → upload.

   Never commit it — `.gitignore` blocks `*firebase-adminsdk*.json`. Expo's
   servers use it when **sending**, so replacing it never needs a rebuild.
3. Rebuild and install — `google-services.json` only reaches phones in a new
   native build. Bump `version` in `app.json`, then `npm run release`.

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
