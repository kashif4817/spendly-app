-- Entry safety for shared books — run in the Supabase SQL editor AFTER
-- shared-books.sql, entry-order.sql and notifications.sql. Safe to re-run.
--
-- A shared book is used for months, and until now the author of an entry
-- could change or delete it at any time — a figure from March quietly
-- rewritten in July — with nothing left behind but one notification the other
-- person may have switched off. This file closes that, and does it HERE rather
-- than in the app, because a rule only the app knows about is a rule a
-- modified app can skip:
--
--   1. A 24-HOUR LOCK. For 24 hours after the server receives an entry, its
--      author may edit or delete it freely (typos, second thoughts, Undo).
--      After that the database refuses, and the change has to go through a
--      request the other member approves. Deleting is locked too — otherwise
--      "delete it and add it again" would walk straight round the lock.
--
--   2. AN ACTIVITY LOG. Every edit, delete and restore, and every entry added
--      for a day before the one it was added on (Pakistan time), is written
--      to shared_entry_log by a trigger: who, when, before and after, and who
--      approved it. Both members read the same log; nobody can change or
--      delete a line of it.
--
--   3. ENTRY CHECKS. Which book an entry is in, who wrote it and when never
--      change. Whoever paid must be in the book. Amounts, dates and notes have
--      to be sane. Someone who has left a book can no longer edit in it.
--
-- WHO THE LOCK APPLIES TO. Only to what a CLIENT sends (the `authenticated`
-- role). This file's own approve function and entry-order.sql's reorder run
-- as their owner, and an approved change is exactly the change both people
-- agreed to — so they pass. Reordering touches `sort` alone, which the lock
-- never looks at.

-- 1) The server's own "received" time -----------------------------------------
--
-- `created_at` comes from the phone, and a phone's clock can be anything. The
-- 24 hours run from `posted_at` instead, which only the server ever writes.
-- Existing entries take it from their created_at (capped at their last
-- update), so an entry from March is locked from day one.

alter table public.shared_entries add column if not exists posted_at timestamptz;
alter table public.shared_entries alter column posted_at set default now();

do $$
declare
  r record;
  v timestamptz;
begin
  for r in select id, created_at, updated_at from public.shared_entries where posted_at is null loop
    begin
      v := r.created_at::timestamptz;
    exception when others then
      v := null;
    end;
    update public.shared_entries
       set posted_at = least(coalesce(v, r.updated_at), r.updated_at)
     where id = r.id;
  end loop;
end;
$$;

alter table public.shared_entries alter column posted_at set not null;

-- 2) What a sane entry looks like --------------------------------------------
--
-- Returns the problem as a bare code (the app words it), or null. A null
-- argument means "not being changed", so an edit only re-checks what it
-- touches and an old row is never held to a rule it predates.
--
-- Invoker on purpose: from a client it sees only that client's books, which
-- is all it needs, and it reveals nothing a client couldn't already read.

create or replace function public.entry_values_problem(
  p_book_id text,
  p_amount  double precision,
  p_note    text,
  p_day     text,
  p_payer   uuid
)
returns text
language plpgsql
stable
set search_path = public
as $$
begin
  -- 'NaN' sorts above every number in Postgres, so the upper bound is what
  -- catches it — along with Infinity and typos with three zeros too many.
  if p_amount is not null and not (p_amount > 0 and p_amount < 1e12) then
    return 'BAD_AMOUNT';
  end if;

  if p_day is not null then
    if p_day !~ '^\d{4}-\d{2}-\d{2}$' or p_day < '2000-01-01' or p_day > '2100-12-31' then
      return 'BAD_DAY';
    end if;
    begin
      perform p_day::date;
    exception when others then
      return 'BAD_DAY';
    end;
  end if;

  if p_note is not null and length(p_note) > 1000 then
    return 'BAD_NOTE';
  end if;

  -- Anyone who is or was in the book: an entry paid by someone who has since
  -- left is still a true record, and must stay editable.
  if p_payer is not null and not exists (
    select 1 from public.shared_book_members m
     where m.book_id = p_book_id and m.user_id = p_payer
  ) then
    return 'BAD_PAYER';
  end if;

  return null;
end;
$$;

-- 3) The guard: checks, frozen fields and the lock ---------------------------
--
-- BEFORE INSERT OR UPDATE. Invoker (not definer) on purpose, so `current_user`
-- says who is really writing: `authenticated` for a phone, the owner inside
-- this project's own definer functions.
--
-- The app uploads entries as upserts, and Postgres runs the INSERT half of
-- this trigger on every one of them before it finds the conflict — which is
-- why the insert branch only stamps and checks, and the frozen fields and the
-- lock live in the UPDATE branch, where the existing row is known.

create or replace function public.guard_shared_entry()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_problem text;
  v_content boolean;
begin
  if tg_op = 'INSERT' then
    new.posted_at := now();
    v_problem := public.entry_values_problem(
      new.book_id, new.amount, new.note, new.day, new.payer_id);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
    return new;
  end if;

  -- What an entry IS never changes: moving it to another book, or rewriting
  -- who wrote it or when, would be a new entry dressed up as an old one.
  new.book_id    := old.book_id;
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  new.posted_at  := coalesce(old.posted_at, new.posted_at);

  v_content := new.amount   is distinct from old.amount
            or new.note     is distinct from old.note
            or new.day      is distinct from old.day
            or new.payer_id is distinct from old.payer_id;

  if v_content then
    v_problem := public.entry_values_problem(
      new.book_id,
      case when new.amount   is distinct from old.amount   then new.amount end,
      case when new.note     is distinct from old.note     then new.note end,
      case when new.day      is distinct from old.day      then new.day end,
      case when new.payer_id is distinct from old.payer_id then new.payer_id end);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
  end if;

  -- The lock. Content changes, deletes and restores all count; `sort` alone
  -- (reordering) and a re-upload of an unchanged row do not.
  if current_user in ('authenticated', 'anon')
     and (v_content or new.deleted is distinct from old.deleted)
     and now() > old.posted_at + interval '24 hours' then
    raise exception 'ENTRY_LOCKED';
  end if;

  return new;
end;
$$;

drop trigger if exists entry_guard on public.shared_entries;
create trigger entry_guard before insert or update on public.shared_entries
  for each row execute function public.guard_shared_entry();

-- Someone who has left a book keeps nothing in it — not even the power to
-- edit what they wrote while they were there. (Repeated in shared-books.sql,
-- so re-running that file keeps it.)
drop policy if exists entry_author_write on public.shared_entries;
create policy entry_author_write on public.shared_entries for update to authenticated
  using (author_id = auth.uid() and public.is_book_member(book_id))
  with check (author_id = auth.uid() and public.is_book_member(book_id));

-- 4) The activity log ---------------------------------------------------------

create table if not exists public.shared_entry_log (
  id           text primary key default gen_random_uuid()::text,
  book_id      text not null references public.shared_books (id) on delete cascade,
  entry_id     text not null,
  -- Whose change it was. Only an author can change an entry, so this is the
  -- entry's author — also when it went through a request.
  actor_id     uuid not null,
  -- The other member, when the change was a request they approved.
  approved_by  uuid,
  -- 'edited' | 'deleted' | 'restored' | 'added_late'
  action       text not null,
  old_amount   double precision,
  old_note     text,
  old_day      text,
  old_payer_id uuid,
  new_amount   double precision,
  new_note     text,
  new_day      text,
  new_payer_id uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists shared_entry_log_book_updated_idx
  on public.shared_entry_log (book_id, updated_at);
create index if not exists shared_entry_log_entry_idx
  on public.shared_entry_log (entry_id);

/**
 * AFTER INSERT OR UPDATE on shared_entries. Definer, because clients have no
 * write access to the log at all — this trigger is the only way in.
 *
 * Not wrapped in an exception handler, unlike the notification triggers: a
 * notification is a courtesy, but a change the log failed to record is a
 * change that should not happen.
 */
create or replace function public.log_shared_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action   text;
  v_approver uuid := nullif(current_setting('spendly.approved_by', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    -- An entry for today is ordinary use. One for any earlier day changes
    -- history that has already happened, so the other member gets to see it
    -- and check it. "Today" is Pakistan's: the server runs on UTC, five hours
    -- behind, and would otherwise miss yesterday's entries added after
    -- midnight. The server's clock, not the phone's — a phone set back a few
    -- days could otherwise add an old entry as if it were new.
    if new.deleted
       or new.day >= to_char((now() at time zone 'Asia/Karachi')::date, 'YYYY-MM-DD') then
      return null;
    end if;
    v_action := 'added_late';
  elsif not old.deleted and new.deleted then
    v_action := 'deleted';
  elsif old.deleted and not new.deleted then
    v_action := 'restored';
  elsif new.deleted then
    return null;
  elsif new.amount   is distinct from old.amount
     or new.note     is distinct from old.note
     or new.day      is distinct from old.day
     or new.payer_id is distinct from old.payer_id then
    v_action := 'edited';
  else
    return null; -- a reorder, or a re-upload of the same row
  end if;

  insert into public.shared_entry_log (
    book_id, entry_id, actor_id, approved_by, action,
    old_amount, old_note, old_day, old_payer_id,
    new_amount, new_note, new_day, new_payer_id)
  values (
    new.book_id, new.id, new.author_id, v_approver, v_action,
    case when tg_op = 'UPDATE' then old.amount end,
    case when tg_op = 'UPDATE' then old.note end,
    case when tg_op = 'UPDATE' then old.day end,
    case when tg_op = 'UPDATE' then old.payer_id end,
    new.amount, new.note, new.day, new.payer_id);

  return null;
end;
$$;

drop trigger if exists entry_log on public.shared_entries;
create trigger entry_log after insert or update on public.shared_entries
  for each row execute function public.log_shared_entry();

-- 5) Approval requests --------------------------------------------------------
--
-- A request carries the EXACT change: approving applies those values and
-- nothing else, so "yes" can never be stretched into a different edit. The
-- entry's values at the time of asking ride along, which is what the other
-- member is shown as "before" — and how a request about an entry that has
-- since changed is recognised and dropped instead of applied.

create table if not exists public.shared_entry_requests (
  id           text primary key default gen_random_uuid()::text,
  book_id      text not null references public.shared_books (id) on delete cascade,
  entry_id     text not null references public.shared_entries (id) on delete cascade,
  requester_id uuid not null,
  kind         text not null check (kind in ('edit', 'delete')),
  old_amount   double precision not null,
  old_note     text not null,
  old_day      text not null,
  old_payer_id uuid not null,
  -- Null for a delete.
  new_amount   double precision,
  new_note     text,
  new_day      text,
  new_payer_id uuid,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  -- Why it was turned down, when the other member said.
  reason       text not null default '',
  decided_by   uuid,
  decided_at   timestamptz,
  expires_at   timestamptz not null default now() + interval '7 days',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One open request per entry. An unanswered one past its expiry still says
-- 'pending' until something touches it — request_entry_change() does that
-- before checking this.
create unique index if not exists shared_entry_requests_one_pending
  on public.shared_entry_requests (entry_id) where status = 'pending';
create index if not exists shared_entry_requests_book_updated_idx
  on public.shared_entry_requests (book_id, updated_at);

/**
 * Ask the other member to approve a change to (or the deletion of) one of
 * your own entries. Returns the new request.
 */
create or replace function public.request_entry_change(
  p_entry_id text,
  p_kind     text,
  p_amount   double precision default null,
  p_note     text default null,
  p_day      text default null,
  p_payer_id uuid default null
)
returns public.shared_entry_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry   public.shared_entries;
  v_req     public.shared_entry_requests;
  v_problem text;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select * into v_entry from public.shared_entries e where e.id = p_entry_id for update;
  if not found or v_entry.deleted or not public.is_book_member(v_entry.book_id) then
    raise exception 'ENTRY_NOT_FOUND';
  end if;
  if v_entry.author_id <> auth.uid() then
    raise exception 'NOT_AUTHOR';
  end if;
  if p_kind is null or p_kind not in ('edit', 'delete') then
    raise exception 'BAD_REQUEST';
  end if;

  if not exists (
    select 1 from public.shared_book_members m
     where m.book_id = v_entry.book_id and m.user_id <> auth.uid() and not m.deleted
  ) then
    raise exception 'NOBODY_TO_ASK';
  end if;

  if p_kind = 'edit' then
    p_note := btrim(coalesce(p_note, ''));
    if p_amount is null or p_day is null or p_payer_id is null then
      raise exception 'BAD_REQUEST';
    end if;
    v_problem := public.entry_values_problem(v_entry.book_id, p_amount, p_note, p_day, p_payer_id);
    if v_problem is not null then
      raise exception '%', v_problem;
    end if;
    if p_amount = v_entry.amount and p_note = v_entry.note
       and p_day = v_entry.day and p_payer_id = v_entry.payer_id then
      raise exception 'NO_CHANGE';
    end if;
  else
    p_amount := null; p_note := null; p_day := null; p_payer_id := null;
  end if;

  -- A request nobody answered in time no longer holds the entry.
  update public.shared_entry_requests r
     set status = 'expired'
   where r.entry_id = p_entry_id and r.status = 'pending' and r.expires_at <= now();

  if exists (
    select 1 from public.shared_entry_requests r
     where r.entry_id = p_entry_id and r.status = 'pending'
  ) then
    raise exception 'REQUEST_PENDING';
  end if;

  insert into public.shared_entry_requests (
    book_id, entry_id, requester_id, kind,
    old_amount, old_note, old_day, old_payer_id,
    new_amount, new_note, new_day, new_payer_id)
  values (
    v_entry.book_id, v_entry.id, auth.uid(), p_kind,
    v_entry.amount, v_entry.note, v_entry.day, v_entry.payer_id,
    p_amount, p_note, p_day, p_payer_id)
  returning * into v_req;

  return v_req;
end;
$$;

/**
 * Approve or turn down a request from the other member. Returns the request
 * as it now stands — which, when it was already answered, cancelled or out of
 * time, is simply how it ended. Nothing is applied in those cases.
 */
create or replace function public.respond_entry_request(
  p_request_id text,
  p_approve    boolean,
  p_reason     text default ''
)
returns public.shared_entry_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req   public.shared_entry_requests;
  v_entry public.shared_entries;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select * into v_req from public.shared_entry_requests r where r.id = p_request_id for update;
  if not found or not public.is_book_member(v_req.book_id) then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  -- Nobody approves their own change: that is the whole point.
  if v_req.requester_id = auth.uid() then
    raise exception 'OWN_REQUEST';
  end if;
  if v_req.status <> 'pending' then
    return v_req;
  end if;

  if v_req.expires_at <= now() then
    update public.shared_entry_requests set status = 'expired'
     where id = v_req.id returning * into v_req;
    return v_req;
  end if;

  -- The entry has to be exactly what the request showed. If it moved on (an
  -- edit inside its first 24 hours, say), approving now would apply the
  -- request to something the approver never saw.
  select * into v_entry from public.shared_entries e where e.id = v_req.entry_id for update;
  if not found or v_entry.deleted
     or v_entry.amount   is distinct from v_req.old_amount
     or v_entry.note     is distinct from v_req.old_note
     or v_entry.day      is distinct from v_req.old_day
     or v_entry.payer_id is distinct from v_req.old_payer_id then
    update public.shared_entry_requests set status = 'cancelled', decided_at = now()
     where id = v_req.id returning * into v_req;
    return v_req;
  end if;

  if p_approve then
    -- Read by the log (who approved) and by notifications.sql (the approver
    -- has just seen the change, so no "edited" push for them). Local to this
    -- transaction, and not something a client can set.
    perform set_config('spendly.approved_by', auth.uid()::text, true);
    if v_req.kind = 'delete' then
      update public.shared_entries set deleted = true where id = v_req.entry_id;
    else
      update public.shared_entries
         set amount = v_req.new_amount, note = v_req.new_note,
             day = v_req.new_day, payer_id = v_req.new_payer_id
       where id = v_req.entry_id;
    end if;
    perform set_config('spendly.approved_by', '', true);

    update public.shared_entry_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now()
     where id = v_req.id returning * into v_req;
  else
    update public.shared_entry_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
           reason = left(btrim(coalesce(p_reason, '')), 300)
     where id = v_req.id returning * into v_req;
  end if;

  return v_req;
end;
$$;

/** Withdraw your own request while it is still waiting. */
create or replace function public.cancel_entry_request(p_request_id text)
returns public.shared_entry_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.shared_entry_requests;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select * into v_req from public.shared_entry_requests r where r.id = p_request_id for update;
  if not found or not public.is_book_member(v_req.book_id) then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_req.requester_id <> auth.uid() then
    raise exception 'NOT_REQUESTER';
  end if;

  if v_req.status = 'pending' then
    update public.shared_entry_requests set status = 'cancelled', decided_at = now()
     where id = v_req.id returning * into v_req;
  end if;
  return v_req;
end;
$$;

-- 6) Approval notifications --------------------------------------------------
--
-- These ring even in a muted book and with every switch off: a request nobody
-- hears about is a change frozen for a week, and the person asking is waiting
-- on an answer. They go on the book-activity channel the app already creates.

create or replace function public.push_book_event_always(
  p_book_id text,
  p_actor   uuid,
  p_only    uuid,
  p_event   text,
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
    and (p_only is null or m.user_id = p_only);

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
      'channelId', 'book-activity',
      'priority', 'high',
      'data', coalesce(p_data, '{}'::jsonb)
              || jsonb_build_object('bookId', p_book_id, 'event', p_event)
    )
  );
exception when others then
  null;
end;
$$;

/** '3 Aug', or '3 Aug 2025' when it isn't this year. */
create or replace function public.notify_day(p_day text)
returns text
language plpgsql
stable
as $$
begin
  if p_day is null then
    return '';
  end if;
  if left(p_day, 4) = to_char(current_date, 'YYYY') then
    return to_char(p_day::date, 'FMDD Mon');
  end if;
  return to_char(p_day::date, 'FMDD Mon YYYY');
exception when others then
  return p_day;
end;
$$;

/**
 * What a request is about, for the person reading it:
 *   Lunch · 3 Aug · PKR 500                     (delete)
 *   Lunch · 3 Aug: PKR 500 → PKR 5,000, paid by you → Kashif   (edit)
 * `p_viewer` is whoever will read it, so "you" means them.
 */
create or replace function public.describe_entry_request(
  r        public.shared_entry_requests,
  p_viewer uuid
)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_label text := coalesce(nullif(btrim(r.old_note), ''), 'Entry')
                  || ' · ' || public.notify_day(r.old_day);
  v_parts text[] := '{}';
begin
  if r.kind = 'delete' then
    return v_label || ' · ' || public.notify_money(r.old_amount);
  end if;

  if r.new_amount is distinct from r.old_amount then
    v_parts := v_parts || (public.notify_money(r.old_amount) || ' → ' || public.notify_money(r.new_amount));
  end if;
  if r.new_payer_id is distinct from r.old_payer_id then
    v_parts := v_parts || ('paid by '
      || case when r.old_payer_id = p_viewer then 'you' else public.notify_name(r.old_payer_id) end
      || ' → '
      || case when r.new_payer_id = p_viewer then 'you' else public.notify_name(r.new_payer_id) end);
  end if;
  if r.new_day is distinct from r.old_day then
    v_parts := v_parts || ('date ' || public.notify_day(r.old_day) || ' → ' || public.notify_day(r.new_day));
  end if;
  if r.new_note is distinct from r.old_note then
    v_parts := v_parts || (case when coalesce(r.new_note, '') = '' then 'note removed'
                               else 'note → ' || r.new_note end);
  end if;

  return v_label || ': ' || array_to_string(v_parts, ', ');
end;
$$;

create or replace function public.notify_entry_request()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_who text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      return new;
    end if;
    v_who := public.notify_name(new.requester_id);
    -- The other member reads this, and the requester is never them.
    perform public.push_book_event_always(
      new.book_id, new.requester_id, null, 'approval',
      '🔒 ' || v_who || ' asked for your approval',
      case when new.kind = 'delete' then 'Delete: ' else 'Change: ' end
        || public.describe_entry_request(new,
             (select m.user_id from public.shared_book_members m
               where m.book_id = new.book_id and m.user_id <> new.requester_id and not m.deleted
               limit 1)),
      jsonb_build_object('type', 'approval', 'requestId', new.id, 'entryId', new.entry_id));

  elsif old.status = 'pending' and new.status in ('approved', 'rejected') then
    v_who := public.notify_name(new.decided_by);
    perform public.push_book_event_always(
      new.book_id, new.decided_by, new.requester_id, 'approval_result',
      case when new.status = 'approved'
           then '✅ ' || v_who || ' approved your ' || case when new.kind = 'delete' then 'delete' else 'change' end
           else v_who || ' turned down your ' || case when new.kind = 'delete' then 'delete' else 'change' end
      end,
      case when new.status = 'rejected' and new.reason <> '' then '“' || new.reason || '” · ' else '' end
        || public.describe_entry_request(new, new.requester_id),
      jsonb_build_object('type', 'approval', 'requestId', new.id, 'entryId', new.entry_id));
  end if;

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists notify_entry_request on public.shared_entry_requests;
create trigger notify_entry_request after insert or update on public.shared_entry_requests
  for each row execute function public.notify_entry_request();

-- 7) Server-owned updated_at, RLS, grants, realtime ---------------------------

do $$
declare t text;
begin
  foreach t in array array['shared_entry_log', 'shared_entry_requests']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before insert or update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

alter table public.shared_entry_log enable row level security;
alter table public.shared_entry_requests enable row level security;

drop policy if exists log_read on public.shared_entry_log;
create policy log_read on public.shared_entry_log for select to authenticated
  using (public.is_book_member(book_id));

drop policy if exists request_read on public.shared_entry_requests;
create policy request_read on public.shared_entry_requests for select to authenticated
  using (public.is_book_member(book_id));

-- Read-only to clients, both of them. Supabase grants everything on a new
-- table by default, so it is taken back first. The log is written only by
-- its trigger; requests only through the three functions above.
revoke all on public.shared_entry_log from anon, authenticated;
revoke all on public.shared_entry_requests from anon, authenticated;
grant select on public.shared_entry_log to authenticated;
grant select on public.shared_entry_requests to authenticated;

-- Functions. The three request calls are the app's; entry_values_problem has
-- to stay callable because the guard trigger runs as the client and calls it;
-- the rest exist for triggers and are not for anyone to call.
revoke all on function public.request_entry_change(text, text, double precision, text, text, uuid) from public, anon;
revoke all on function public.respond_entry_request(text, boolean, text) from public, anon;
revoke all on function public.cancel_entry_request(text) from public, anon;
revoke all on function public.entry_values_problem(text, double precision, text, text, uuid) from public, anon;
grant execute on function public.request_entry_change(text, text, double precision, text, text, uuid) to authenticated;
grant execute on function public.respond_entry_request(text, boolean, text) to authenticated;
grant execute on function public.cancel_entry_request(text) to authenticated;
grant execute on function public.entry_values_problem(text, double precision, text, text, uuid) to authenticated;

revoke all on function public.guard_shared_entry() from public, anon, authenticated;
revoke all on function public.log_shared_entry() from public, anon, authenticated;
revoke all on function public.notify_entry_request() from public, anon, authenticated;
revoke all on function public.push_book_event_always(text, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.notify_day(text) from public, anon, authenticated;
revoke all on function public.describe_entry_request(public.shared_entry_requests, uuid)
  from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['shared_entry_log', 'shared_entry_requests']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;  -- already published; fine to re-run
    end;
  end loop;
end;
$$;

-- 8) Did it work? -------------------------------------------------------------
-- Expect: entry_guard and entry_log on shared_entries, notify_entry_request on
-- shared_entry_requests, and 0 entries without a posted_at.

select tgname as trigger_name, tgrelid::regclass as on_table
  from pg_trigger
 where tgname in ('entry_guard', 'entry_log', 'notify_entry_request')
 order by tgname;

select count(*) as entries_missing_posted_at
  from public.shared_entries
 where posted_at is null;
