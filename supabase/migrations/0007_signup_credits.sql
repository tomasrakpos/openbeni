-- OpenHarneks — guarantee 5 welcome credits for every new signup
-- Run after 0006_free_model_routers.sql in the Supabase SQL editor.
--
-- Two creation paths must both grant exactly 5 credits:
--   1. auth.users trigger  -> public.handle_new_user()
--   2. first API request   -> /api/session (functions/api/_lib/auth.ts)
-- This migration pins the column default, the app setting, and the trigger.

-- 1. Column default: any profile inserted without an explicit value gets 5.
alter table public.profiles
  alter column credits set default 5;

-- 2. App setting used by the API path (admin can still change it later in the panel).
update public.app_settings
  set default_signup_credits = 5
  where default_signup_credits is distinct from 5;

-- 3. Make the auth trigger explicit so it never depends on column defaults.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, credits)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    5
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Verify (optional):
--   select column_default from information_schema.columns
--   where table_schema='public' and table_name='profiles' and column_name='credits';
--   -- expect: 5
