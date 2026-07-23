-- ============================================================================
-- WIPE ALL SPENDLY DATA  —  Supabase → SQL Editor → paste → Run
-- ============================================================================
-- DANGER: This permanently deletes ALL rows in ALL app tables for EVERY user.
-- There is no undo. Use it to reset the project to an empty state for testing.
--
-- It does NOT drop tables or change schema — the structure stays intact, so the
-- app keeps working; it just starts empty. Run schema.sql etc. first if the
-- tables don't exist yet.
--
-- Order/`cascade` handles foreign keys. `restart identity` resets any sequences.
-- ============================================================================

truncate table
  public.transactions,
  public.categories,
  public.loans,
  public.loan_payments,
  public.ledger_entries,
  public.budgets,
  public.profiles
restart identity cascade;

-- Also remove uploaded files (receipt photos + avatars) from Storage.
delete from storage.objects where bucket_id in ('receipts', 'avatars');

-- ----------------------------------------------------------------------------
-- OPTIONAL — also delete the signed-up accounts themselves (a totally fresh
-- start, as if no one ever logged in). Leave commented out to keep accounts.
-- Because every table above references auth.users with ON DELETE CASCADE,
-- deleting a user would also clear their rows — but we truncate first anyway.
-- ----------------------------------------------------------------------------
-- delete from auth.users;

-- Quick sanity check — every count should be 0 after running.
select
  (select count(*) from public.transactions)   as transactions,
  (select count(*) from public.categories)      as categories,
  (select count(*) from public.loans)           as loans,
  (select count(*) from public.loan_payments)   as loan_payments,
  (select count(*) from public.ledger_entries)  as ledger_entries,
  (select count(*) from public.budgets)         as budgets,
  (select count(*) from public.profiles)        as profiles;
