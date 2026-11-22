-- OpenHarneks — signup credits (default 5) and personal API tokens
-- Run this after 0001_init.sql..0003_public_catalog_rls.sql in Supabase SQL editor.

-- 1. Credits balance on user profiles (5 credits granted on signup)
alter table public.profiles
  add column if not exists credits integer not null default 5 check (credits >= 0);

alter table public.app_settings
  add column if not exists default_signup_credits integer not null default 5 check (default_signup_credits >= 0);

-- 2. Atomic credit deduction used by /api/chat
create or replace function public.consume_user_credit(p_user uuid, p_amount integer default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
begin
  update public.profiles
  set credits = credits - greatest(1, p_amount)
  where id = p_user and credits >= greatest(1, p_amount)
  returning credits into v_remaining;

  return v_remaining;
end;
$$;

revoke all on function public.consume_user_credit(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_user_credit(uuid, integer) to service_role;

-- 3. Personal user API tokens (only SHA-256 hash + short prefix are stored)
create table if not exists public.user_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists user_tokens_user_idx on public.user_tokens (user_id, created_at desc);

alter table public.user_tokens enable row level security;

drop policy if exists "user_tokens: read own" on public.user_tokens;
create policy "user_tokens: read own"
  on public.user_tokens for select
  to authenticated
  using (user_id = auth.uid());
