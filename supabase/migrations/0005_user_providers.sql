-- OpenHarneks — User-added (BYOK) providers & models + credit-exempt billing tracking
-- Run this after 0004_credits_and_tokens.sql in Supabase SQL editor.
--
-- Billing policy enforced by the backend (/api/chat):
--   * Default site catalog models (`billing_source = 'site'`) deduct user credits
--     and count toward site daily/monthly token quotas.
--   * User-added providers/models (`billing_source = 'byok'`) NEVER deduct site
--     credits and NEVER count toward site token quotas.

-- ---------------------------------------------------------------------------
-- User-owned providers (BYOK; API key stored as AES-256-GCM ciphertext only)
-- ---------------------------------------------------------------------------
create table if not exists public.user_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  base_url text not null,
  api_format text not null default 'openai' check (api_format in ('openai', 'anthropic', 'gemini', 'custom')),
  auth_header text,
  auth_prefix text,
  extra_headers jsonb not null default '{}'::jsonb,
  api_key_ciphertext text,
  key_hint text,
  icon text,
  color text,
  notes text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_providers_user_idx
  on public.user_providers (user_id, created_at asc);

alter table public.user_providers enable row level security;
-- No direct browser policies: all reads/writes go through authenticated
-- server endpoints (/api/user-providers) using the service role so
-- `api_key_ciphertext` is never exposed to clients.

drop trigger if exists user_providers_touch on public.user_providers;
create trigger user_providers_touch before update on public.user_providers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- User-owned models belonging to a user_provider
-- ---------------------------------------------------------------------------
create table if not exists public.user_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  user_provider_id uuid not null references public.user_providers (id) on delete cascade,
  upstream_id text not null,
  display_name text not null,
  context_window bigint,
  capabilities text[] not null default array['text'],
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_provider_id, upstream_id)
);

create index if not exists user_models_user_idx on public.user_models (user_id);
create index if not exists user_models_provider_idx on public.user_models (user_provider_id);

alter table public.user_models enable row level security;

drop trigger if exists user_models_touch on public.user_models;
create trigger user_models_touch before update on public.user_models
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Usage events: distinguish site-billed calls from credit-exempt BYOK calls
-- ---------------------------------------------------------------------------
alter table public.usage_events
  add column if not exists billing_source text not null default 'site'
    check (billing_source in ('site', 'byok')),
  add column if not exists credits_charged integer not null default 0
    check (credits_charged >= 0),
  add column if not exists user_provider_id uuid references public.user_providers (id) on delete set null;

create index if not exists usage_events_user_billing_time_idx
  on public.usage_events (user_id, billing_source, created_at desc);

-- Site token quotas only sum site-model usage; user BYOK usage is exempt.
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
  where user_id = p_user
    and billing_source = 'site'
    and created_at >= p_since;
$$;

revoke all on function public.user_usage_totals(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.user_usage_totals(uuid, timestamptz) to service_role;
