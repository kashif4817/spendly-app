-- ============================================================================
-- Cleanup: remove the RASAD control-plane tables that were run into the
-- expense app's Supabase project by mistake.
--
-- SAFE — this touches ONLY the 6 Rasad tables. It does NOT drop the expense
-- app's tables (categories, transactions, loans, loan_payments, budgets), it
-- does NOT touch Supabase Auth (auth.users), and it KEEPS the shared
-- public.set_updated_at() function — your expense-app triggers still use it.
--
-- Run the whole file once in the Supabase SQL editor.
-- ============================================================================

-- Drop children first (CASCADE also handles FKs, triggers and indexes).
drop table if exists public.audit_log       cascade;
drop table if exists public.alerts          cascade;
drop table if exists public.health_checks   cascade;
drop table if exists public.project_metrics cascade;
drop table if exists public.projects        cascade;
drop table if exists public.users           cascade;

-- NOTE: public.set_updated_at() is intentionally NOT dropped — it is shared
-- with the expense app's triggers.

-- ---------------------------------------------------------------------------
-- Optional hygiene: undo the broad privileges the Rasad script handed to the
-- PUBLIC "anon" role. Your expense tables are already protected by RLS, so this
-- is not strictly required, but anon has no reason to hold table grants. It
-- only touches `anon` (never `authenticated`, which the app uses), so the
-- expense app keeps working.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------------------------------------------------------------------------
-- Verify: this should now list ONLY the five expense tables —
-- budgets, categories, loan_payments, loans, transactions.
-- ---------------------------------------------------------------------------
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
