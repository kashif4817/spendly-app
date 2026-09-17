-- Per-person pin / archive flags — run once in the Supabase SQL editor
-- (after schema.sql and ledger.sql).
--
-- There is no "people" table: a person exists because their name appears in
-- ledger_entries. This table hangs the extra per-person state off that name.
-- The id is derived from the name by the app (`PF-<name>`), so two devices that
-- pin the same person independently write the SAME row instead of duplicating.
--
-- Until this runs, the app simply skips the table when syncing: pins and
-- archives stay on the device and upload themselves once the table exists.

create table if not exists public.person_flags (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  person     text not null,
  pinned     smallint not null default 0,
  archived   smallint not null default 0,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

alter table public.person_flags enable row level security;

drop policy if exists own_rows on public.person_flags;
create policy own_rows on public.person_flags for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists set_updated_at on public.person_flags;
create trigger set_updated_at before insert or update on public.person_flags
  for each row execute function public.set_updated_at();

create index if not exists person_flags_user_updated_idx on public.person_flags (user_id, updated_at);

grant select, insert, update, delete on public.person_flags to authenticated;
