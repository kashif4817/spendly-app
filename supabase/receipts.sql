-- Receipt photos — run once in the Supabase SQL editor (after schema.sql).
-- Adds the transactions column, a PRIVATE storage bucket, and per-user access
-- policies so each account can only touch files under its own {user_id}/ folder.

-- 1) Column the app syncs (path like '{user_id}/{transaction_id}.jpg')
alter table public.transactions add column if not exists receipt_path text;

-- 2) Private bucket
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- 3) Row Level Security on the storage objects, scoped to the owner's folder.
drop policy if exists receipts_select_own on storage.objects;
create policy receipts_select_own on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists receipts_insert_own on storage.objects;
create policy receipts_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists receipts_update_own on storage.objects;
create policy receipts_update_own on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists receipts_delete_own on storage.objects;
create policy receipts_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
