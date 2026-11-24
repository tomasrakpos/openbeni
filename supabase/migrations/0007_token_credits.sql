-- OpenHarneks — token-based credit system with atomic reservations and ledger
-- Run this after 0001_init.sql..0006_free_model_routers.sql in Supabase SQL editor.
--
-- Security model:
--   * Every user starts with 5 credits once after first sign-in (`reason = 'signup_grant'`).
--   * Users can read only their own balance (`user_credits`) and history (`credit_ledger`).
--   * Nobody except the server (`service_role`) can write to `user_credits`,
--     `credit_ledger`, or `credit_reservations`, or call the atomic RPC functions.

-- ---------------------------------------------------------------------------
-- 1. Model weight and configurable credit policy bounds
-- ---------------------------------------------------------------------------
alter table public.catalog_models
  add column if not exists model_weight numeric(8, 2) not null default 1.00
  check (model_weight > 0);

alter table public.app_settings
  alter column default_signup_credits type numeric(12, 2) using default_signup_credits::numeric(12, 2);

alter table public.app_settings
  alter column default_signup_credits set default 5.00;

alter table public.app_settings
  add column if not exists min_credits_per_request numeric(8, 2) not null default 0.50
  check (min_credits_per_request >= 0);

alter table public.app_settings
  add column if not exists max_credits_per_request numeric(8, 2) not null default 3.00
  check (max_credits_per_request >= min_credits_per_request);

-- Support fractional credit balances/charges (e.g. 0.5, 1.5, 4.5) on legacy columns too.
alter table public.profiles
  alter column credits type numeric(12, 2) using credits::numeric(12, 2);

alter table public.profiles
  alter column credits set default 5.00;

alter table public.usage_events
  alter column credits_charged type numeric(12, 2) using credits_charged::numeric(12, 2);

-- ---------------------------------------------------------------------------
-- 2. Core credit tables
-- ---------------------------------------------------------------------------

-- Authoritative per-user balance (unique primary key on user_id ensures one-time grant).
create table if not exists public.user_credits (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance numeric(12, 2) not null default 5.00 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- Complete immutable audit trail of every credit grant and deduction.
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta numeric(12, 2) not null,
  reason text not null,
  model_id uuid references public.catalog_models (id) on delete set null,
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_time_idx
  on public.credit_ledger (user_id, created_at desc);

-- Active & historical reservations held while a chat request is in flight.
create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'reserved' check (status in ('reserved', 'committed', 'released')),
  created_at timestamptz not null default now()
);

create index if not exists credit_reservations_user_status_idx
  on public.credit_reservations (user_id, status, created_at desc);

-- Backfill existing profiles once without overwriting any existing user_credits rows.
insert into public.user_credits (user_id, balance, updated_at)
select p.id, greatest(0, coalesce(p.credits, 5.00)), now()
from public.profiles p
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security (RLS)
-- ---------------------------------------------------------------------------
alter table public.user_credits enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.credit_reservations enable row level security;

revoke all on public.user_credits from public, anon, authenticated;
revoke all on public.credit_ledger from public, anon, authenticated;
revoke all on public.credit_reservations from public, anon, authenticated;

grant select on public.user_credits to authenticated;
grant select on public.credit_ledger to authenticated;

drop policy if exists "user_credits: read own" on public.user_credits;
create policy "user_credits: read own"
  on public.user_credits for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "credit_ledger: read own" on public.credit_ledger;
create policy "credit_ledger: read own"
  on public.credit_ledger for select
  to authenticated
  using (user_id = auth.uid());

-- No policies on credit_reservations: only service_role may read or write it.

-- ---------------------------------------------------------------------------
-- 4. Atomic SQL functions (service_role ONLY)
-- ---------------------------------------------------------------------------

-- One-time initial signup grant (default 5 credits). Safe under concurrent first logins.
create or replace function public.ensure_user_credits(
  p_user uuid,
  p_signup_credits numeric default 5.00
)
returns table (balance numeric, granted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant numeric(12, 2) := greatest(0, round(coalesce(p_signup_credits, 5.00)::numeric, 2));
  v_balance numeric(12, 2);
begin
  insert into public.user_credits (user_id, balance, updated_at)
  values (p_user, v_grant, now())
  on conflict (user_id) do nothing
  returning user_credits.balance into v_balance;

  if found then
    insert into public.credit_ledger (user_id, delta, reason, model_id, tokens_in, tokens_out)
    values (p_user, v_grant, 'signup_grant', null, 0, 0);

    update public.profiles
    set credits = v_balance
    where id = p_user;

    return query select v_balance, true;
    return;
  end if;

  select uc.balance into v_balance
  from public.user_credits uc
  where uc.user_id = p_user;

  return query select coalesce(v_balance, 0.00), false;
end;
$$;

revoke all on function public.ensure_user_credits(uuid, numeric) from public, anon, authenticated;
grant execute on function public.ensure_user_credits(uuid, numeric) to service_role;

-- Atomic reservation with row-level locking (`FOR UPDATE`) so concurrent requests
-- can never spend beyond the user's available balance.
create or replace function public.reserve_user_credits(
  p_user uuid,
  p_amount numeric,
  p_min_required numeric default 0.50
)
returns table (
  ok boolean,
  reservation_id uuid,
  reserved_amount numeric,
  available_balance numeric,
  balance numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(12, 2);
  v_reserved numeric(12, 2);
  v_available numeric(12, 2);
  v_min numeric(12, 2) := greatest(0, round(coalesce(p_min_required, 0.50)::numeric, 2));
  v_requested numeric(12, 2) := greatest(v_min, round(coalesce(p_amount, v_min)::numeric, 2));
  v_hold numeric(12, 2);
  v_res_id uuid;
begin
  -- Lock the user's balance row first so concurrent requests serialize cleanly.
  select uc.balance into v_balance
  from public.user_credits uc
  where uc.user_id = p_user
  for update;

  if not found then
    return query select false, null::uuid, 0.00::numeric, 0.00::numeric, 0.00::numeric;
    return;
  end if;

  -- Release orphaned reservations older than 30 minutes (e.g. crashed worker).
  update public.credit_reservations
  set status = 'released'
  where user_id = p_user
    and status = 'reserved'
    and created_at < now() - interval '30 minutes';

  select coalesce(sum(amount), 0.00) into v_reserved
  from public.credit_reservations
  where user_id = p_user and status = 'reserved';

  v_available := greatest(0.00, round((v_balance - v_reserved)::numeric, 2));

  if v_available < v_min then
    return query select false, null::uuid, 0.00::numeric, v_available, v_balance;
    return;
  end if;

  -- Reserve up to the estimated cap, bounded by the currently available balance.
  v_hold := least(v_requested, v_available);

  insert into public.credit_reservations (user_id, amount, status)
  values (p_user, v_hold, 'reserved')
  returning id into v_res_id;

  return query select
    true,
    v_res_id,
    v_hold,
    greatest(0.00, round((v_available - v_hold)::numeric, 2)),
    v_balance;
end;
$$;

revoke all on function public.reserve_user_credits(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.reserve_user_credits(uuid, numeric, numeric) to service_role;

-- Atomic commit: deducts only the actual calculated usage, records the ledger entry,
-- marks the reservation committed (or released if 0), and keeps profiles.credits in sync.
create or replace function public.commit_credit_reservation(
  p_reservation_id uuid,
  p_actual_amount numeric,
  p_reason text default 'chat_usage',
  p_model_id uuid default null,
  p_tokens_in integer default 0,
  p_tokens_out integer default 0
)
returns table (charged numeric, balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.credit_reservations%rowtype;
  v_balance numeric(12, 2);
  v_actual numeric(12, 2) := greatest(0.00, round(coalesce(p_actual_amount, 0.00)::numeric, 2));
  v_charge numeric(12, 2);
begin
  select * into v_res
  from public.credit_reservations
  where id = p_reservation_id
  for update;

  if not found then
    return query select 0.00::numeric, 0.00::numeric;
    return;
  end if;

  select uc.balance into v_balance
  from public.user_credits uc
  where uc.user_id = v_res.user_id
  for update;

  if not found then
    v_balance := 0.00;
  end if;

  -- Idempotency: already finalized reservation is never charged twice.
  if v_res.status <> 'reserved' then
    return query select 0.00::numeric, v_balance;
    return;
  end if;

  -- Never exceed current balance or the locked reservation ceiling.
  v_charge := least(v_balance, v_res.amount, v_actual);

  if v_charge > 0 then
    v_balance := greatest(0.00, round((v_balance - v_charge)::numeric, 2));

    update public.user_credits
    set balance = v_balance, updated_at = now()
    where user_id = v_res.user_id;

    update public.profiles
    set credits = v_balance
    where id = v_res.user_id;

    update public.credit_reservations
    set status = 'committed'
    where id = v_res.id;

    insert into public.credit_ledger (user_id, delta, reason, model_id, tokens_in, tokens_out)
    values (
      v_res.user_id,
      -v_charge,
      coalesce(nullif(trim(p_reason), ''), 'chat_usage'),
      p_model_id,
      greatest(0, coalesce(p_tokens_in, 0)),
      greatest(0, coalesce(p_tokens_out, 0))
    );
  else
    update public.credit_reservations
    set status = 'released'
    where id = v_res.id;
  end if;

  return query select v_charge, v_balance;
end;
$$;

revoke all on function public.commit_credit_reservation(uuid, numeric, text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.commit_credit_reservation(uuid, numeric, text, uuid, integer, integer) to service_role;

-- Atomic release: frees an unused reservation without charging the user.
create or replace function public.release_credit_reservation(p_reservation_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_balance numeric(12, 2);
begin
  update public.credit_reservations
  set status = 'released'
  where id = p_reservation_id and status = 'reserved'
  returning user_id into v_user_id;

  if v_user_id is null then
    select user_id into v_user_id
    from public.credit_reservations
    where id = p_reservation_id;
  end if;

  select uc.balance into v_balance
  from public.user_credits uc
  where uc.user_id = v_user_id;

  return coalesce(v_balance, 0.00);
end;
$$;

revoke all on function public.release_credit_reservation(uuid) from public, anon, authenticated;
grant execute on function public.release_credit_reservation(uuid) to service_role;

-- Keep legacy `consume_user_credit` compatible with numeric amounts & ledger.
create or replace function public.consume_user_credit(p_user uuid, p_amount numeric default 1.00)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge numeric(12, 2) := greatest(0.00, round(coalesce(p_amount, 1.00)::numeric, 2));
  v_remaining numeric(12, 2);
begin
  update public.user_credits
  set balance = round((balance - v_charge)::numeric, 2), updated_at = now()
  where user_id = p_user and balance >= v_charge
  returning balance into v_remaining;

  if found then
    update public.profiles
    set credits = v_remaining
    where id = p_user;

    insert into public.credit_ledger (user_id, delta, reason, model_id, tokens_in, tokens_out)
    values (p_user, -v_charge, 'chat_usage', null, 0, 0);
  end if;

  return v_remaining;
end;
$$;

revoke all on function public.consume_user_credit(uuid, numeric) from public, anon, authenticated;
grant execute on function public.consume_user_credit(uuid, numeric) to service_role;

-- Update auth.users trigger so new Google/email signups immediately get their
-- one-time 5-credit grant in user_credits + credit_ledger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signup numeric(12, 2) := 5.00;
begin
  select coalesce(default_signup_credits, 5.00) into v_signup
  from public.app_settings
  where id = true
  limit 1;

  insert into public.profiles (id, email, display_name, credits)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    v_signup
  )
  on conflict (id) do nothing;

  perform public.ensure_user_credits(new.id, v_signup);
  return new;
end;
$$;
