-- Push notifications for shared books — run in the Supabase SQL editor AFTER
-- shared-books.sql and shared-chat.sql. Safe to re-run, and re-running it is
-- how you upgrade.
--
-- WHAT RINGS. Every notification goes to the OTHER member of a book, never to
-- whoever caused it, and only ever about a shared book:
--
--   event          when                                         channel
--   ─────────────  ───────────────────────────────────────────  ─────────────
--   message        a chat message                               chat
--   reminder       a balance reminder (a message of that kind)  chat
--   reaction       a reaction to a message YOU sent             chat
--   entry_added    an entry added (directly or by a split),     book-activity
--                  or a deleted one restored
--   entry_edited   an entry's amount, note, day or payer changed book-activity
--   entry_deleted  an entry deleted                             book-activity
--   joined         someone joined the book                      book-activity
--
-- Approval requests for locked entries ring too, but they live with the lock
-- in entry-safety.sql, and they ignore mute and the switches below.
--
-- WHO MAY SILENCE WHAT. Each install's push_tokens row carries two lists the
-- app keeps up to date: `muted_books` (books muted on that phone) and
-- `off_events` (switches turned off on the Notifications screen). They have to
-- be checked HERE: when the app is closed, Android shows a push without asking
-- the app, so a preference only the app knows about is one it cannot keep.
-- They stay private and per-phone all the same — push_tokens is own-row only.
--
-- NOTHING HERE CAN FAIL A WRITE. Every trigger swallows its own errors, and
-- pg_net posts to Expo without waiting for the answer: a notification is a
-- courtesy, the row it is about is the data.

create extension if not exists pg_net with schema extensions;

-- 1) Columns -----------------------------------------------------------------

alter table public.push_tokens add column if not exists muted_books text[] not null default '{}';
alter table public.push_tokens add column if not exists off_events  text[] not null default '{}';

-- Also added by shared-chat.sql; repeated so this file never runs ahead of it.
alter table public.shared_messages add column if not exists kind text default '';

-- 2) Helpers -----------------------------------------------------------------
--
-- Plain (invoker) functions: called from the definer triggers below they run
-- as the table owner, and called directly by a client they would only see what
-- that client's RLS already allows. Execute is revoked from clients anyway at
-- the end — nothing outside these triggers has any use for them.

/** 'PKR 1,250' / 'PKR 1,250.50' — the same text the app's formatMoney makes. */
create or replace function public.notify_money(p_amount double precision)
returns text
language sql
immutable
as $$
  select 'PKR ' || regexp_replace(
    to_char(round(abs(coalesce(p_amount, 0))::numeric, 2), 'FM999,999,999,990.00'),
    '\.00$', '')
$$;

/** A member's name as the app shows it: their name, else their email's local part. */
create or replace function public.notify_name(p_user uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select coalesce(nullif(btrim(p.name), ''),
                     nullif(split_part(coalesce(p.email, ''), '@', 1), ''))
       from public.profiles p
      where p.id = p_user),
    'Someone')
$$;

/** The book's own name, or null when it has none worth repeating. */
create or replace function public.notify_book_name(p_book text)
returns text
language sql
stable
set search_path = public
as $$
  select nullif(btrim(b.name), '') from public.shared_books b where b.id = p_book
$$;

/**
 * Send one notification to the members of a book.
 *
 *   p_actor  — whoever caused it. Never notified, on any of their devices.
 *   p_only   — just this member (a reaction goes to the message's sender
 *              only), or null for every other member.
 *   p_event  — one of the events in the table at the top. A phone that has
 *              switched it off, or muted this book, is skipped.
 *
 * `bookId` and `event` are added to the data, which is what the app routes a
 * tap by and what its foreground handler filters on.
 */
create or replace function public.push_book_event(
  p_book_id text,
  p_actor   uuid,
  p_only    uuid,
  p_event   text,
  p_channel text,
  p_title   text,
  p_body    text,
  p_data    jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tokens text[];
begin
  select array_agg(t.id) into v_tokens
  from public.push_tokens t
  join public.shared_book_members m on m.user_id = t.user_id
  where m.book_id = p_book_id
    and not m.deleted
    and not t.deleted
    and m.user_id <> p_actor
    and (p_only is null or m.user_id = p_only)
    and not (p_book_id = any (t.muted_books))
    and not (p_event = any (t.off_events));

  if v_tokens is null then
    return;
  end if;

  perform net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'accept', 'application/json'
    ),
    body    := jsonb_build_object(
      'to', to_jsonb(v_tokens),
      'title', p_title,
      'body', left(coalesce(p_body, ''), 180),
      'sound', 'default',
      -- Must match a channel the app creates (lib/notifications.ts): Android
      -- drops a notification whose channel doesn't exist on the device.
      'channelId', p_channel,
      'priority', 'high',
      'data', coalesce(p_data, '{}'::jsonb)
              || jsonb_build_object('bookId', p_book_id, 'event', p_event)
    )
  );
exception when others then
  null; -- pg_net missing or Expo unreachable; the write it is about still stands
end;
$$;

-- 3) Chat messages and balance reminders --------------------------------------

create or replace function public.notify_shared_message()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sender text;
  v_book   text;
  v_body   text;
begin
  if new.deleted or new.deleted_at is not null then
    return new;
  end if;

  v_sender := public.notify_name(new.sender_id);
  v_book   := public.notify_book_name(new.book_id);

  -- A vanishing message is never previewed: the whole promise is that it
  -- leaves no copy behind, and a notification quoting it would sit in the
  -- shade long after the message itself had gone from both devices.
  if new.vanish_at is not null then
    v_body := 'Sent a message';
  else
    v_body := coalesce(nullif(btrim(new.body), ''),
                       case when new.entry_id is not null then 'Shared an entry'
                            else 'Sent a message' end);
  end if;

  if coalesce(new.kind, '') = 'reminder' then
    perform public.push_book_event(
      new.book_id, new.sender_id, null, 'reminder', 'chat',
      '💰 ' || v_sender || ' sent a balance reminder',
      v_body,
      jsonb_build_object('type', 'chat', 'messageId', new.id));
  else
    perform public.push_book_event(
      new.book_id, new.sender_id, null, 'message', 'chat',
      v_sender || coalesce(' · ' || v_book, ''),
      v_body,
      jsonb_build_object('type', 'chat', 'messageId', new.id));
  end if;

  return new;
exception when others then
  return new;
end;
$$;

-- 4) Entries — added, edited, deleted -----------------------------------------
--
-- The app uploads each entry as an upsert and deletes by setting `deleted`, so
-- an INSERT is a new entry and an UPDATE is everything else. Only the columns
-- a person would call "the entry" count as an edit: a re-upload of an
-- unchanged row, or a reorder (which touches `sort` alone), rings nobody.
--
-- Split payments need nothing special — a split writes ordinary entries.

create or replace function public.notify_shared_entry()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_event  text;
  v_verb   text;
  v_actor  text;
  v_book   text;
  v_amount text;
  v_paid   text;
begin
  -- A change the other member just approved (entry-safety.sql sets this for
  -- the length of the approval). They've seen it; the requester hears about
  -- it from the approval notification instead.
  if coalesce(current_setting('spendly.approved_by', true), '') <> '' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.deleted then return new; end if;
    v_event := 'entry_added';   v_verb := 'added';
  elsif not old.deleted and new.deleted then
    v_event := 'entry_deleted'; v_verb := 'deleted';
  elsif old.deleted and not new.deleted then
    v_event := 'entry_added';   v_verb := 'restored';
  elsif new.deleted then
    return new;
  elsif old.amount   is distinct from new.amount
     or old.note     is distinct from new.note
     or old.day      is distinct from new.day
     or old.payer_id is distinct from new.payer_id then
    v_event := 'entry_edited';  v_verb := 'edited';
  else
    return new;
  end if;

  -- Only the author can write an entry, so the author is who did this.
  v_actor := public.notify_name(new.author_id);
  v_book  := public.notify_book_name(new.book_id);

  -- Read by the other member only, so "you" can only ever mean them.
  v_paid := case when new.payer_id = new.author_id then 'paid by ' || v_actor
                 else 'paid by you' end;

  v_amount := public.notify_money(new.amount);
  if v_event = 'entry_edited' and old.amount is distinct from new.amount then
    v_amount := public.notify_money(old.amount) || ' → ' || v_amount;
  end if;

  perform public.push_book_event(
    new.book_id, new.author_id, null, v_event, 'book-activity',
    v_actor || ' ' || v_verb || ' an entry' || coalesce(' · ' || v_book, ''),
    coalesce(nullif(btrim(new.note), '') || ' · ', '') || v_amount || ', ' || v_paid,
    jsonb_build_object('type', 'book', 'entryId', new.id));

  return new;
exception when others then
  return new;
end;
$$;

-- 5) Reactions -----------------------------------------------------------------
--
-- Only to the person whose message it is, and only when the reaction is new
-- or changed — taking one back, or a re-upload of the same one, rings nobody.

create or replace function public.notify_shared_reaction()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_msg   public.shared_messages;
  v_about text;
begin
  if new.deleted or coalesce(new.emoji, '') = '' then
    return new;
  end if;
  if tg_op = 'UPDATE' and not old.deleted and old.emoji is not distinct from new.emoji then
    return new;
  end if;

  select * into v_msg from public.shared_messages where id = new.message_id;
  if not found
     or v_msg.sender_id = new.user_id
     or v_msg.deleted
     or v_msg.deleted_at is not null then
    return new;
  end if;

  v_about := case
    when v_msg.vanish_at is not null or btrim(v_msg.body) = '' then 'your message'
    else '“' || left(btrim(v_msg.body), 80) || '”'
  end;

  perform public.push_book_event(
    new.book_id, new.user_id, v_msg.sender_id, 'reaction', 'chat',
    public.notify_name(new.user_id) || ' reacted ' || new.emoji,
    'to ' || v_about,
    jsonb_build_object('type', 'chat', 'reactionTo', new.message_id));

  return new;
exception when others then
  return new;
end;
$$;

-- 6) Someone joined ---------------------------------------------------------------
--
-- A new membership row, or a member who had left coming back. The creator's
-- own row when a book is made has nobody else to tell, so it rings no one.

create or replace function public.notify_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.deleted then
    return new;
  end if;
  if tg_op = 'UPDATE' and not old.deleted then
    return new;
  end if;

  perform public.push_book_event(
    new.book_id, new.user_id, null, 'joined', 'book-activity',
    public.notify_name(new.user_id) || ' joined '
      || coalesce(public.notify_book_name(new.book_id), 'your shared book'),
    'You can both add entries and chat in it now.',
    jsonb_build_object('type', 'book'));

  return new;
exception when others then
  return new;
end;
$$;

-- 7) Triggers ------------------------------------------------------------------

drop trigger if exists notify_message on public.shared_messages;
create trigger notify_message after insert on public.shared_messages
  for each row execute function public.notify_shared_message();

drop trigger if exists notify_entry on public.shared_entries;
create trigger notify_entry after insert or update on public.shared_entries
  for each row execute function public.notify_shared_entry();

drop trigger if exists notify_reaction on public.shared_reactions;
create trigger notify_reaction after insert or update on public.shared_reactions
  for each row execute function public.notify_shared_reaction();

drop trigger if exists notify_member on public.shared_book_members;
create trigger notify_member after insert or update on public.shared_book_members
  for each row execute function public.notify_member_joined();

-- Nothing here is for clients to call. Supabase grants EXECUTE on new public
-- functions to anon and authenticated by default, so it is taken back
-- explicitly — push_book_event in particular would otherwise let anyone ring
-- the members of a book.
revoke all on function public.notify_money(double precision) from public, anon, authenticated;
revoke all on function public.notify_name(uuid) from public, anon, authenticated;
revoke all on function public.notify_book_name(text) from public, anon, authenticated;
revoke all on function public.push_book_event(text, uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.notify_shared_message() from public, anon, authenticated;
revoke all on function public.notify_shared_entry() from public, anon, authenticated;
revoke all on function public.notify_shared_reaction() from public, anon, authenticated;
revoke all on function public.notify_member_joined() from public, anon, authenticated;

-- Check: expect four rows — notify_entry, notify_member, notify_message,
-- notify_reaction.
select tgname as trigger_name, tgrelid::regclass as on_table
from pg_trigger
where tgname in ('notify_message', 'notify_entry', 'notify_reaction', 'notify_member')
order by tgname;
