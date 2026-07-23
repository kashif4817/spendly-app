-- People ledger (khata) — run once in the Supabase SQL editor (after schema.sql).
-- One row per give/take entry, scoped to the account by Row Level Security.
-- Uses the public.set_updated_at() function already created by schema.sql.

create table if not exists public.ledger_entries (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  person     text not null,
  direction  text not null check (direction in ('gave', 'took')),
  amount     double precision not null,
  note       text not null default '',
  day        text not null,
  created_at text not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

alter table public.ledger_entries enable row level security;

drop policy if exists own_rows on public.ledger_entries;
create policy own_rows on public.ledger_entries for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists set_updated_at on public.ledger_entries;
create trigger set_updated_at before insert or update on public.ledger_entries
  for each row execute function public.set_updated_at();

create index if not exists ledger_entries_user_updated_idx on public.ledger_entries (user_id, updated_at);

grant select, insert, update, delete on public.ledger_entries to authenticated;
