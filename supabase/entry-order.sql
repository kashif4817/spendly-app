-- Hand-arranged entry order — run once in the Supabase SQL editor.
-- Safe to re-run: every statement is idempotent.
--
-- Entries get recorded in the order you remember them, not the order they
-- happened. `sort` is how the app remembers a day that someone has arranged by
-- hand: 1-based in display order, 0 (the default) meaning "nobody has", in
-- which case the statement falls back to newest-first as it always did.
--
-- UNTIL THIS FILE HAS BEEN RUN the app still works — the order just stays on
-- the phone that set it. A push that mentions a column the project doesn't
-- have drops that column and sends the rest of the row (see sync/engine.ts),
-- so an over-the-air update reaching a device before this SQL costs nothing
-- but the syncing of the order itself.

-- 1) The column -------------------------------------------------------------

alter table public.ledger_entries  add column if not exists sort integer not null default 0;
alter table public.shared_entries  add column if not exists sort integer not null default 0;

-- 2) Reordering a shared day ------------------------------------------------
--
-- A day in a shared book usually mixes both members' entries, and arranging it
-- has to move all of them. But `shared_entries` lets only an author write
-- their own row (policy `entry_author_write` in shared-books.sql), and that is
-- the rule that stops either side quietly rewriting the record — so it stays.
--
-- The way out is that the ORDER is not the record. It is a shared view of it,
-- and this is a definer function that touches `sort` and nothing else. A
-- member may call it; what they cannot do through it is change an amount, a
-- note, a date or who paid.
--
-- Locked to a fixed search_path so a caller can't shadow the tables it writes,
-- same as is_book_member() and friends next door.

create or replace function public.reorder_entries(p_book_id text, p_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The membership check is the whole authorisation story: without it a
  -- definer function would happily reorder a stranger's book.
  if not public.is_book_member(p_book_id) then
    raise exception 'not a member of this book';
  end if;

  -- `with ordinality` turns the array's position into the sort value, so one
  -- statement writes the whole day. `book_id` is matched as well as `id` so a
  -- caller cannot smuggle in an entry from a book they don't belong to.
  --
  -- updated_at is left to the set_updated_at trigger, which is what makes the
  -- other member's device notice on its next pull.
  update public.shared_entries e
     set sort = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where e.id = o.id
     and e.book_id = p_book_id;
end;
$$;

revoke all on function public.reorder_entries(text, text[]) from public;
grant execute on function public.reorder_entries(text, text[]) to authenticated;

-- 3) Did it work? -----------------------------------------------------------
-- Expect two rows (ledger_entries, shared_entries) and one function.

select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and column_name = 'sort'
   and table_name in ('ledger_entries', 'shared_entries')
 order by table_name;

select routine_name, security_type
  from information_schema.routines
 where routine_schema = 'public'
   and routine_name = 'reorder_entries';
