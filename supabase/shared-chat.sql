-- Shared-book chat — run once in the Supabase SQL editor, after shared-books.sql.
--
-- A shared book already holds what two people owe each other. This adds the
-- conversation that goes with it: a message thread per book, plus the ability
-- to pin a message to one entry ("what was this 4,500 for?").
--
-- THREE TABLES, each doing one job:
--
--   shared_messages — the thread. One row per message, scoped to a book, so
--                     RLS can reuse is_book_member() from shared-books.sql.
--   shared_reads    — how far each member has read. One row per (book, user),
--                     which is what turns "newest message" into an unread
--                     count that agrees across that member's own devices.
--   push_tokens     — where to reach a member who isn't looking at the app.
--
-- WHY A READ MARKER RATHER THAN A PER-MESSAGE FLAG: a flag per message per
-- reader is a row per message per member to write, sync and reconcile, for an
-- answer ("how many have I not seen") that one timestamp already gives. The
-- marker also syncs as a single last-write-wins row, so reading on the phone
-- clears the badge on the tablet without any extra machinery.

-- 1) Tables -----------------------------------------------------------------

create table if not exists public.shared_messages (
  id         text primary key,
  book_id    text not null references public.shared_books (id) on delete cascade,
  sender_id  uuid not null references auth.users (id) on delete cascade,
  body       text not null default '',
  -- The entry this message is about, or null for ordinary chat.
  --
  -- Deliberately NOT a foreign key. Entries sync through the outbox, so a
  -- message can legitimately reach the server a moment before the entry it
  -- quotes; a constraint here would reject the message and leave it retrying
  -- forever if that entry were never accepted. The app resolves the id
  -- locally and simply shows the quote as unavailable when it can't.
  entry_id   text,
  -- The message this one answers, or null for an ordinary message.
  --
  -- An id, not a copy of the quoted text, so a retraction empties the quote
  -- everywhere at once rather than leaving the retracted words preserved
  -- inside every reply to them.
  --
  -- Deliberately NOT a self-referencing foreign key, for the same reason
  -- entry_id is not one: replies and the messages they answer travel through
  -- the outbox independently, so a reply can legitimately arrive first. A
  -- constraint here would reject it and leave it retrying forever.
  reply_to   text,
  -- When the sender retracted it, or null while it stands.
  --
  -- NOT the same thing as `deleted` below, and the difference is the point.
  -- `deleted` is the sync layer's tombstone: it means "drop this row", and a
  -- dropped row leaves the other person's thread with a silent hole where a
  -- message used to be. `deleted_at` keeps the row and empties it, so the
  -- thread still says something was said and then taken back — while the body
  -- itself is genuinely gone from both devices and from here.
  deleted_at text,
  -- When this message deletes itself, or null if it is permanent.
  --
  -- Written by the SENDER from the book's `expire_after` at the moment of
  -- sending, and never recomputed. Changing the setting therefore leaves
  -- messages already sent exactly as they were promised to be: turning
  -- disappearing messages on does not reach back and burn the history, and
  -- turning it off does not resurrect something that was supposed to go.
  expires_at text,
  -- When the sender last changed the words, or null if they never did.
  --
  -- The time rather than a flag, so "edited" can be shown with the moment it
  -- happened. Only the sender can set it — the message UPDATE policy already
  -- says so — which is what stops an edit being a way to put words in
  -- someone else's mouth.
  edited_at text,
  -- Set when the message was sent into a VANISHING session, null otherwise.
  --
  -- Different from `expires_at`, and deliberately: that is a clock the sender
  -- starts, this is a mode both people agreed to. A vanishing message has no
  -- deadline at all — it lives exactly as long as the thread stays open, and
  -- each device drops its own copy the moment that person walks away.
  vanish_at text,
  created_at text not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

/**
 * Tap-backs.
 *
 * A row per (message, person) rather than a column on the message, because
 * the whole point is reacting to what the OTHER person said — and the message
 * table's UPDATE policy deliberately lets nobody but the sender touch their
 * own row. A separate table keeps that intact: you own your reaction, they
 * own their message, and neither policy has to be loosened.
 */
create table if not exists public.shared_reactions (
  -- '<message_id>:<user_id>'. One reaction per person per message, so
  -- reacting again REPLACES the old one instead of piling up, and the same
  -- person on two devices produces one row rather than two.
  id         text primary key,
  book_id    text not null references public.shared_books (id) on delete cascade,
  -- Not a foreign key, for the same reason entry_id isn't: a reaction and the
  -- message it is about travel through the outbox independently, so the
  -- reaction can legitimately arrive first.
  message_id text not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- Cleared rather than deleted when you take a reaction back, so the removal
  -- syncs as an ordinary update like everything else here.
  emoji      text not null default '',
  created_at text not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

create table if not exists public.shared_reads (
  -- '<book_id>:<user_id>', so two devices marking the same book read produce
  -- the SAME row rather than two that have to be merged.
  id           text primary key,
  book_id      text not null references public.shared_books (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  /** created_at of the newest message that reached this member's device. */
  delivered_at text not null default '',
  /** created_at of the newest message this member has actually read. */
  last_read_at text not null default '',
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false,
  unique (book_id, user_id)
);

create table if not exists public.push_tokens (
  -- The Expo token itself is the id: one row per install, and a device that
  -- re-registers overwrites its own row instead of adding another.
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  platform   text not null default '',
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

-- Columns added after the first release. Here as well as in the table above so
-- that re-running this file upgrades a project that already has these tables.
alter table public.shared_messages add column if not exists deleted_at text;
alter table public.shared_messages add column if not exists reply_to text;
alter table public.shared_messages add column if not exists expires_at text;

-- How long a message in this book lives, in seconds; 0 is off.
--
-- On the BOOK rather than on each member: disappearing messages are an
-- agreement between two people about one conversation, and a setting only one
-- side could see would be a promise the other never made.
alter table public.shared_books add column if not exists expire_after integer not null default 0;
alter table public.shared_messages add column if not exists edited_at text;
alter table public.shared_messages add column if not exists vanish_at text;

-- The one message held at the top of this book's thread, or null.
--
-- On the BOOK rather than on the message, because pinning what the OTHER
-- person said would mean writing to their message row — which is exactly what
-- `message_sender_write` exists to prevent. One pin per conversation is also
-- the better rule: a wall of pins is just the thread again.
alter table public.shared_books add column if not exists pinned_message text;

-- Whether this book is in a vanishing session, and who asked for one.
--
--   ''           — off
--   'ask:<uuid>' — that member has invited the other into one
--   'on'         — both agreed; messages sent now clear when either walks away
--
-- An invitation rather than a switch one person flips. The thread sits beside
-- a shared ledger, so "this conversation leaves no record" is a thing both
-- people should have agreed to, not something one of them discovers later.
alter table public.shared_books add column if not exists vanish_state text not null default '';
alter table public.shared_reads
  add column if not exists delivered_at text not null default '';

create index if not exists shared_messages_book_created_idx
  on public.shared_messages (book_id, created_at);
create index if not exists shared_messages_book_updated_idx
  on public.shared_messages (book_id, updated_at);
create index if not exists shared_messages_expiry_idx
  on public.shared_messages (expires_at) where expires_at is not null;
create index if not exists shared_reactions_message_idx
  on public.shared_reactions (message_id);
create index if not exists shared_reactions_book_updated_idx
  on public.shared_reactions (book_id, updated_at);
create index if not exists shared_reads_user_idx
  on public.shared_reads (user_id);
create index if not exists push_tokens_user_idx
  on public.push_tokens (user_id) where not deleted;

-- 2) Row Level Security ------------------------------------------------------

alter table public.shared_messages enable row level security;
alter table public.shared_reactions enable row level security;
alter table public.shared_reads enable row level security;
alter table public.push_tokens enable row level security;

-- Messages: any member of the book reads the thread and may add to it; only
-- the sender can touch their own message afterwards. Same shape as entries —
-- neither side gets to rewrite what the other said.
drop policy if exists message_read on public.shared_messages;
create policy message_read on public.shared_messages for select to authenticated
  using (public.is_book_member(book_id));

drop policy if exists message_insert on public.shared_messages;
create policy message_insert on public.shared_messages for insert to authenticated
  with check (public.is_book_member(book_id) and sender_id = auth.uid());

drop policy if exists message_sender_write on public.shared_messages;
create policy message_sender_write on public.shared_messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- Reactions: any member reads them all — a tap-back nobody else can see is
-- not a reply — but you may only write your own. Same split as a read marker,
-- and for the same reason: neither can be forged on someone else's behalf.
drop policy if exists reaction_read on public.shared_reactions;
create policy reaction_read on public.shared_reactions for select to authenticated
  using (public.is_book_member(book_id));

drop policy if exists reaction_insert on public.shared_reactions;
create policy reaction_insert on public.shared_reactions for insert to authenticated
  with check (public.is_book_member(book_id) and user_id = auth.uid());

drop policy if exists reaction_own_write on public.shared_reactions;
create policy reaction_own_write on public.shared_reactions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Read markers: both members may READ each other's marker, which is what lets
-- the app show "Seen". Writing one is own-row only, so a read receipt can
-- never be forged on someone else's behalf.
drop policy if exists read_marker_read on public.shared_reads;
create policy read_marker_read on public.shared_reads for select to authenticated
  using (public.is_book_member(book_id));

drop policy if exists read_marker_insert on public.shared_reads;
create policy read_marker_insert on public.shared_reads for insert to authenticated
  with check (public.is_book_member(book_id) and user_id = auth.uid());

drop policy if exists read_marker_write on public.shared_reads;
create policy read_marker_write on public.shared_reads for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Push tokens: strictly your own. A token is a capability to ring someone's
-- phone, so this is the one table in the feature nobody else may read —
-- including the person you share a book with. Only the definer function in
-- section 5 reads across accounts, and it only ever hands tokens to Expo.
drop policy if exists own_push_token on public.push_tokens;
create policy own_push_token on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3) Server-owned updated_at -------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['shared_messages', 'shared_reactions', 'shared_reads', 'push_tokens']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before insert or update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- 4) Grants ------------------------------------------------------------------
-- Revoked first so re-running this file tightens an earlier, broader grant
-- rather than leaving it in place.

revoke all on public.shared_messages from authenticated;
revoke all on public.shared_reactions from authenticated;
revoke all on public.shared_reads from authenticated;
revoke all on public.push_tokens from authenticated;

-- Deleting a message is soft (`deleted = true`), so UPDATE covers it. A
-- message that has reached its `expires_at` is the one exception: both devices
-- drop it outright, which the sender turns into `deleted = true` here.
grant select, insert, update on public.shared_messages to authenticated;
grant select, insert, update on public.shared_reactions to authenticated;
grant select, insert, update on public.shared_reads to authenticated;
grant select, insert, update on public.push_tokens to authenticated;

-- The disappearing-messages setting joins the book's name as the second thing
-- either member may change. Everything else on a book — the join code, the
-- owner — stays out of a client's reach, because the grant is per column.
--
-- Repeated here as well as in shared-books.sql so that re-running EITHER file
-- leaves both columns writable; that file revokes before it grants.
grant update (name, expire_after, pinned_message, vanish_state) on public.shared_books to authenticated;

-- 5) Push notifications ------------------------------------------------------
--
-- A message only reaches the other phone through Realtime while that phone is
-- awake with the app open. The rest of the time — screen off, app swiped away
-- — the only thing that can reach it is a push, and the only moment we know a
-- message exists is the insert that created it. So the insert sends it.
--
-- pg_net posts to Expo's push service and does not wait for the reply, so a
-- slow or unreachable push service can never slow down (or fail) the write
-- that a user is waiting on. The whole call is wrapped in an exception block
-- for the same reason: notifications are a courtesy, the message is the data.

create extension if not exists pg_net with schema extensions;

/**
 * Tell every OTHER member of the book that a message arrived.
 *
 * SECURITY DEFINER because it reads `push_tokens` and `profiles` rows that
 * belong to the recipient, not to the sender. It never returns them — the
 * tokens go straight to Expo — and the search_path is fixed so a caller can't
 * shadow the tables it reads.
 */
create or replace function public.notify_shared_message()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sender  text;
  v_book    text;
  v_tokens  text[];
  v_preview text;
begin
  if new.deleted or new.deleted_at is not null then return new; end if;

  select array_agg(t.id) into v_tokens
  from public.push_tokens t
  join public.shared_book_members m on m.user_id = t.user_id
  where m.book_id = new.book_id
    and m.user_id <> new.sender_id
    and not m.deleted
    and not t.deleted;

  -- Nobody to tell: a book with one member, or a member who has never granted
  -- notification permission.
  if v_tokens is null or array_length(v_tokens, 1) = 0 then
    return new;
  end if;

  select coalesce(
           nullif(btrim(p.name), ''),
           nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
           'Someone')
    into v_sender
  from public.profiles p
  where p.id = new.sender_id;

  select nullif(btrim(b.name), '') into v_book
  from public.shared_books b
  where b.id = new.book_id;

  -- The title carries who it's from; the book only needs saying when it has a
  -- name of its own, and a message about an entry says so rather than opening
  -- with an empty line when the sender sent the quote alone.
  -- A vanishing message is never previewed. The whole promise is that it
  -- leaves no copy behind, and a notification that quotes it would sit in the
  -- shade long after the message itself had gone from both devices.
  if new.vanish_at is not null then
    v_preview := 'Sent a message';
  else
    v_preview := coalesce(nullif(btrim(new.body), ''),
                          case when new.entry_id is not null then 'Shared an entry'
                               else 'Sent a message' end);
  end if;

  begin
    perform net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'accept', 'application/json'
      ),
      body    := jsonb_build_object(
        'to', to_jsonb(v_tokens),
        'title', coalesce(v_sender, 'Spendly') ||
                 case when v_book is null then '' else ' · ' || v_book end,
        'body', left(v_preview, 180),
        'sound', 'default',
        -- Must match the channel the app creates (lib/notifications.ts).
        -- Android drops a notification whose channel doesn't exist.
        'channelId', 'chat',
        'priority', 'high',
        'data', jsonb_build_object(
          'type', 'chat',
          'bookId', new.book_id,
          'messageId', new.id
        )
      )
    );
  exception when others then
    -- pg_net missing, or Expo unreachable. The message is already committed;
    -- the other phone will see it on its next pull either way.
    null;
  end;

  return new;
end;
$$;

revoke all on function public.notify_shared_message() from public;

drop trigger if exists notify_message on public.shared_messages;
create trigger notify_message after insert on public.shared_messages
  for each row execute function public.notify_shared_message();

-- 6) Realtime ----------------------------------------------------------------
-- Messages and read markers join the shared tables already on the publication,
-- so a message lands on the other phone as it is sent and "Seen" appears the
-- moment it is read. Realtime applies RLS per subscriber, so a subscriber is
-- only ever sent rows from books they belong to.

do $$
declare t text;
begin
  foreach t in array array['shared_messages', 'shared_reactions', 'shared_reads']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;  -- already published; fine to re-run
    end;
  end loop;
end;
$$;

alter table public.shared_messages replica identity full;
alter table public.shared_reactions replica identity full;
alter table public.shared_reads replica identity full;
