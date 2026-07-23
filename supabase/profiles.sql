-- User profiles + avatars — run once in the Supabase SQL editor (after schema.sql).
--
-- NOTE: this intentionally does NOT store passwords. Supabase Auth already keeps
-- each password securely hashed (see Authentication → Users). Keeping a second
-- plaintext copy would be a serious security risk, especially since the app
-- ships a public anon key.

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  name       text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before insert or update on public.profiles
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.profiles to authenticated;

-- Avatars bucket (private; the app reads via short-lived signed URLs).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

drop policy if exists avatars_select_own on storage.objects;
create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
