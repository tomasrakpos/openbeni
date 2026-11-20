-- OpenHarness / apiset-pro — initial schema
-- Run this once in the Supabase SQL editor (or with `supabase db push`).
--
-- Security model
--   * The browser talks to Supabase Auth and to our own /api/* functions only.
--   * Provider keys and the admin tables are never readable by `anon` or
--     `authenticated`. They are only touched with the service-role key on the
--     server (RLS is bypassed there on purpose).
--   * A user can read their own profile and their own usage rows, nothing else.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'blocked')),
  daily_token_limit bigint,
  monthly_token_limit bigint,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- Users may edit their own display name. Role, status and quotas are
-- deliberately not grantable, so they can only change on the server.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- App settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id boolean primary key default true check (id = true),
  signup_open boolean not null default true,
  default_daily_token_limit bigint,
  default_monthly_token_limit bigint,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
-- No policies: only the service role can read or write it.

-- ---------------------------------------------------------------------------
-- Providers
-- ---------------------------------------------------------------------------
create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  api_format text not null default 'openai' check (api_format in ('openai', 'anthropic', 'gemini', 'custom')),
  auth_header text,
  auth_prefix text,
  extra_headers jsonb not null default '{}'::jsonb,
  icon text,
  color text,
  notes text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.providers enable row level security;

-- ---------------------------------------------------------------------------
-- Provider keys (AES-256-GCM ciphertext only)
-- ---------------------------------------------------------------------------
create table if not exists public.provider_keys (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  ciphertext text not null,
  label text,
  enabled boolean not null default true,
  cooldown_until timestamptz,
  fail_count integer not null default 0,
  last_error text,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists provider_keys_provider_idx on public.provider_keys (provider_id);

alter table public.provider_keys enable row level security;

-- ---------------------------------------------------------------------------
-- Catalog models (what users are allowed to see in the picker)
-- ---------------------------------------------------------------------------
create table if not exists public.catalog_models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  upstream_id text not null,
  display_name text not null,
  context_window bigint,
  capabilities text[] not null default array['text'],
  tier text not null default 'unknown' check (tier in ('free', 'paid', 'unknown')),
  enabled boolean not null default false,
  upstream_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, upstream_id)
);

create index if not exists catalog_models_provider_idx on public.catalog_models (provider_id);
create index if not exists catalog_models_enabled_idx on public.catalog_models (enabled) where enabled;

alter table public.catalog_models enable row level security;

-- ---------------------------------------------------------------------------
-- Usage events (metadata only — never message text)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_events (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider_id uuid references public.providers (id) on delete set null,
  model_id uuid references public.catalog_models (id) on delete set null,
  model_name text not null default '',
  provider_name text not null default '',
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  status text not null default 'ok',
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_time_idx on public.usage_events (user_id, created_at desc);
create index if not exists usage_events_time_idx on public.usage_events (created_at desc);

alter table public.usage_events enable row level security;

drop policy if exists "usage: read own" on public.usage_events;
create policy "usage: read own"
  on public.usage_events for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Aggregates used by the proxy (quota) and the admin panel
-- ---------------------------------------------------------------------------

-- Per-user totals since a timestamp. SECURITY DEFINER so the service role can
-- call it cheaply; EXECUTE is revoked from browser roles below.
create or replace function public.user_usage_totals(p_user uuid, p_since timestamptz)
returns table (input_tokens bigint, output_tokens bigint)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(prompt_tokens), 0)::bigint as input_tokens,
    coalesce(sum(completion_tokens), 0)::bigint as output_tokens
  from public.usage_events
  where user_id = p_user and created_at >= p_since;
$$;

revoke all on function public.user_usage_totals(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.user_usage_totals(uuid, timestamptz) to service_role;

create or replace view public.user_usage_summary as
  select
    user_id,
    coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
    coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
    count(*)::bigint as requests
  from public.usage_events
  group by user_id;

revoke all on public.user_usage_summary from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- First-login profile provisioning
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep `updated_at` fresh.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists providers_touch on public.providers;
create trigger providers_touch before update on public.providers
  for each row execute function public.touch_updated_at();

drop trigger if exists catalog_models_touch on public.catalog_models;
create trigger catalog_models_touch before update on public.catalog_models
  for each row execute function public.touch_updated_at();
