-- Shared books (a two-person khata) — run once in the Supabase SQL editor,
-- after schema.sql, ledger.sql, profiles.sql and person-flags.sql.
--
-- A shared book is one ledger two accounts can both see and both write to.
--
-- THE KEY IDEA: an entry stores WHO PAID (`payer_id`), never "gave"/"took".
-- Gave/took is relative to whoever is looking, so it would mean opposite things
-- on the two phones. `payer_id` is absolute, so both devices store the exact
-- same row and each one computes the sign for its own user:
--
--     your balance = SUM(amount WHERE payer_id = you)
--                  - SUM(amount WHERE payer_id = them)
--
-- Your friend records "I paid 100" → one row → his phone shows "owes you 100",
-- yours shows "you owe 100". No mirrored copies to keep in step.

-- 1) Tables -----------------------------------------------------------------

create table if not exists public.shared_books (
  id              text primary key,
  name            text not null default '',
  owner_id        uuid not null references auth.users (id) on delete cascade,
  join_code       text unique,
  code_expires_at timestamptz,
  created_at      text not null,
  updated_at      timestamptz not null default now(),
  deleted         boolean not null default false
);

create table if not exists public.shared_book_members (
  id         text primary key,
  book_id    text not null references public.shared_books (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  joined_at  text not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  unique (book_id, user_id)
);

create table if not exists public.shared_entries (
  id         text primary key,
  book_id    text not null references public.shared_books (id) on delete cascade,
  author_id  uuid not null references auth.users (id) on delete cascade,
  -- Who handed over the money. The whole design rests on this being absolute.
  payer_id   uuid not null references auth.users (id) on delete cascade,
  amount     double precision not null,
  note       text not null default '',
  day        text not null,
  created_at text not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

create index if not exists shared_entries_book_updated_idx
  on public.shared_entries (book_id, updated_at);
create index if not exists shared_book_members_user_idx
  on public.shared_book_members (user_id);

-- 2) Membership helpers ------------------------------------------------------
--
-- These are SECURITY DEFINER on purpose. The policy for "you may read a book
-- you belong to" has to look at shared_book_members, and the policy on
-- shared_book_members would then have to look at itself — which Postgres
-- rejects as infinite recursion. A definer function runs without RLS and
-- breaks the cycle. Both are locked to a fixed search_path so a caller can't
-- shadow the tables they read.

create or replace function public.is_book_member(p_book_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.shared_book_members m
    where m.book_id = p_book_id
      and m.user_id = auth.uid()
      and not m.deleted
  );
$$;

/** True when the caller and p_user are both in at least one book together. */
create or replace function public.shares_book_with(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.shared_book_members me
    join public.shared_book_members them on them.book_id = me.book_id
    where me.user_id = auth.uid()
      and them.user_id = p_user
      and not me.deleted
      and not them.deleted
  );
$$;

-- 3) Row Level Security ------------------------------------------------------

alter table public.shared_books enable row level security;
alter table public.shared_book_members enable row level security;
alter table public.shared_entries enable row level security;

-- Books: members read, and either member may retitle the book — it's a label
-- both of them live with, not financial data.
--
-- An RLS policy covers a whole row, so it cannot say "only the name column".
-- That restriction comes from the column-level GRANT further down, which hands
-- clients UPDATE on `name` alone. Rotating the code and changing the owner stay
-- out of reach even though this policy allows the row to be updated.
drop policy if exists book_read on public.shared_books;
create policy book_read on public.shared_books for select to authenticated
  using (public.is_book_member(id));

drop policy if exists book_owner_write on public.shared_books;
drop policy if exists book_member_rename on public.shared_books;
create policy book_member_rename on public.shared_books for update to authenticated
  using (public.is_book_member(id)) with check (public.is_book_member(id));

-- Membership rows are readable by the book's members, and you may remove
-- yourself (leave). There is deliberately NO insert policy: joining goes
-- through join_book() below, so knowing a book's id is never enough to get in.
drop policy if exists member_read on public.shared_book_members;
create policy member_read on public.shared_book_members for select to authenticated
  using (public.is_book_member(book_id));

drop policy if exists member_leave on public.shared_book_members;
create policy member_leave on public.shared_book_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Entries: any member reads and adds; only the author may change or delete
-- their own. This is what stops either side quietly rewriting the record.
drop policy if exists entry_read on public.shared_entries;
create policy entry_read on public.shared_entries for select to authenticated
  using (public.is_book_member(book_id));

drop policy if exists entry_insert on public.shared_entries;
create policy entry_insert on public.shared_entries for insert to authenticated
  with check (public.is_book_member(book_id) and author_id = auth.uid());

drop policy if exists entry_author_write on public.shared_entries;
create policy entry_author_write on public.shared_entries for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- Let members see each other's name and avatar. Without this every entry your
-- friend adds would be labelled "Unknown" — profiles is otherwise own-row only.
drop policy if exists co_member_profile on public.profiles;
create policy co_member_profile on public.profiles for select to authenticated
  using (auth.uid() = id or public.shares_book_with(id));

-- 4) Server-owned updated_at -------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['shared_books', 'shared_book_members', 'shared_entries']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before insert or update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- Grants, kept as narrow as the app actually needs. Revoked first so that
-- re-running this file TIGHTENS an earlier, broader grant instead of leaving
-- it in place — a grant is additive, it is not replaced by a later one.
revoke all on public.shared_books from authenticated;
revoke all on public.shared_book_members from authenticated;
revoke all on public.shared_entries from authenticated;

-- Books: read, and rename. UPDATE is granted on `name` only, which is what
-- keeps join_code and owner_id out of a client's hands. Rows are created by
-- create_book() and never deleted by a client, so no INSERT or DELETE.
grant select on public.shared_books to authenticated;
grant update (name) on public.shared_books to authenticated;

-- Membership: read, and mark your own row deleted to leave. Joining goes
-- through join_book(), so again no INSERT.
grant select on public.shared_book_members to authenticated;
grant update (deleted, updated_at) on public.shared_book_members to authenticated;

-- Entries: read, add, and edit. Deleting is soft (`deleted = true`), so UPDATE
-- covers it and a hard DELETE is never needed.
grant select, insert, update on public.shared_entries to authenticated;

-- 5) Join codes --------------------------------------------------------------

/**
 * A 6-character code from an alphabet with no O/0/I/1, so it survives being
 * read aloud or typed from a photo.
 *
 * NOTE: random() is not a cryptographic RNG. That is acceptable here because a
 * code is useless on its own — codes expire, the owner can rotate one at any
 * time, and a book that already has two members rejects everyone else. If you
 * later open books to larger groups, revisit this.
 */
create or replace function public.gen_join_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.shared_books b where b.join_code = code);
  end loop;
  return code;
end;
$$;

/** How long a freshly minted code stays usable. */
create or replace function public.join_code_ttl()
returns interval language sql immutable as $$ select interval '7 days' $$;

/**
 * Create a book and put the caller in it as owner, in one transaction.
 *
 * Definer because there is no insert policy on shared_book_members — that is
 * the point: the only two ways to gain membership are creating a book and
 * redeeming a code, and both are this file's code, not the client's.
 */
create or replace function public.create_book(p_id text, p_name text)
returns public.shared_books
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book public.shared_books;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  insert into public.shared_books (id, name, owner_id, join_code, code_expires_at, created_at)
  values (
    p_id,
    coalesce(nullif(btrim(p_name), ''), 'Shared book'),
    auth.uid(),
    public.gen_join_code(),
    now() + public.join_code_ttl(),
    to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
  returning * into v_book;

  insert into public.shared_book_members (id, book_id, user_id, joined_at)
  values (p_id || ':' || auth.uid()::text, v_book.id, auth.uid(), v_book.created_at);

  return v_book;
end;
$$;

/**
 * Redeem a code and return the book.
 *
 * This is the only lookup by code anywhere. Exposing "select a book by its
 * code" to clients would let anyone sweep the whole code space; here a wrong
 * code just raises, and the caller learns nothing about which books exist.
 */
create or replace function public.join_book(p_code text)
returns public.shared_books
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book    public.shared_books;
  v_members int;
  v_already boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select * into v_book
  from public.shared_books b
  where b.join_code = upper(btrim(p_code))
    and not b.deleted;

  if not found then
    raise exception 'INVALID_CODE';
  end if;

  if v_book.code_expires_at is not null and v_book.code_expires_at < now() then
    raise exception 'CODE_EXPIRED';
  end if;

  select exists (
    select 1 from public.shared_book_members m
    where m.book_id = v_book.id and m.user_id = auth.uid() and not m.deleted
  ) into v_already;

  if not v_already then
    select count(*) into v_members
    from public.shared_book_members m
    where m.book_id = v_book.id and not m.deleted;

    -- A book is for two people. Without this, a leaked code is an open door.
    if v_members >= 2 then
      raise exception 'BOOK_FULL';
    end if;

    insert into public.shared_book_members (id, book_id, user_id, joined_at)
    values (
      v_book.id || ':' || auth.uid()::text,
      v_book.id,
      auth.uid(),
      to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
    on conflict (book_id, user_id) do update set deleted = false;
  end if;

  return v_book;
end;
$$;

/** Mint a fresh code, invalidating the old one. Owner only. */
create or replace function public.rotate_join_code(p_book_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not exists (
    select 1 from public.shared_books b
    where b.id = p_book_id and b.owner_id = auth.uid()
  ) then
    raise exception 'NOT_OWNER';
  end if;

  v_code := public.gen_join_code();
  update public.shared_books
  set join_code = v_code, code_expires_at = now() + public.join_code_ttl()
  where id = p_book_id;

  return v_code;
end;
$$;

revoke all on function public.create_book(text, text) from public;
revoke all on function public.join_book(text) from public;
revoke all on function public.rotate_join_code(text) from public;
grant execute on function public.create_book(text, text) to authenticated;
grant execute on function public.join_book(text) to authenticated;
grant execute on function public.rotate_join_code(text) to authenticated;

-- 6) Realtime ----------------------------------------------------------------
-- Put the shared tables on the realtime publication so both phones hear about
-- a change the moment it lands. Realtime applies RLS per subscriber, so a
-- subscriber is only ever sent rows from books they belong to.

do $$
declare t text;
begin
  foreach t in array array['shared_books', 'shared_book_members', 'shared_entries']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;  -- already published; fine to re-run
    end;
  end loop;
end;
$$;

-- Realtime sends old-row data on UPDATE/DELETE only with a replica identity.
alter table public.shared_entries replica identity full;
alter table public.shared_book_members replica identity full;
