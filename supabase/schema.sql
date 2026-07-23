-- Spendly — Supabase backend schema (multi-tenant, offline-first sync)
--
-- HOW TO RUN: Supabase Dashboard → SQL Editor → New query → paste all of this →
-- Run. Safe to run more than once (uses IF NOT EXISTS / CREATE OR REPLACE).
--
-- Model: one row per record, keyed by the same TEXT UUID the app uses locally.
-- `user_id` ties every row to a Supabase Auth account; Row Level Security makes
-- sure one account can never read or write another's data. `updated_at` is set
-- by the server (last-write-wins). Deletes are soft (`deleted = true`) so other
-- devices learn about them on their next pull.

-- 1) Tables -----------------------------------------------------------------

create table if not exists public.categories (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  emoji      text not null,
  type       text not null check (type in ('in', 'out')),
  is_preset  smallint not null default 0,
  sort       integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

create table if not exists public.transactions (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  type       text not null check (type in ('in', 'out')),
  amount     double precision not null,
  category   text not null,
  note       text not null default '',
  day        text not null,
  created_at text not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

create table if not exists public.loans (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  direction  text not null check (direction in ('given', 'taken')),
  person     text not null,
  amount     double precision not null,
  note       text not null default '',
  day        text not null,
  created_at text not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

create table if not exists public.loan_payments (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  loan_id    text not null,
  amount     double precision not null,
  day        text not null,
  created_at text not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

create table if not exists public.budgets (
  id         text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   text not null default '',
  amount     double precision not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

-- 2) Server-owned updated_at -------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 3) RLS, triggers, indexes, grants (applied to every table) -----------------

do $$
declare
  t text;
begin
  foreach t in array array['categories', 'transactions', 'loans', 'loan_payments', 'budgets']
  loop
    -- Only the owner can touch their rows.
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);

    -- Server sets updated_at on every insert/update.
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before insert or update on public.%I
         for each row execute function public.set_updated_at()', t);

    -- Pull queries scan by (user_id, updated_at).
    execute format(
      'create index if not exists %I on public.%I (user_id, updated_at)',
      t || '_user_updated_idx', t);

    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;
