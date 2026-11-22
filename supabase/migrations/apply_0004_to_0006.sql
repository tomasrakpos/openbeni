-- OpenHarneks: run 0004 + 0005 + 0006 in one go (idempotent).
-- Paste this whole file into Supabase -> SQL Editor -> Run.

-- ===========================================================================
-- 0004_credits_and_tokens.sql
-- ===========================================================================
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


-- ===========================================================================
-- 0005_user_providers.sql
-- ===========================================================================
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


-- ===========================================================================
-- 0006_free_model_routers.sql
-- ===========================================================================
-- OpenHarneks / apiset-pro — Free Model Routers & explicit pricing classification
-- Run after 0005_user_providers.sql in the Supabase SQL editor (or `supabase db push`).
--
-- Security & Integrity model:
--   * `catalog_models.pricing` and `user_models.pricing` record verified pricing
--     ('free' | 'paid' | 'unknown'). Unknown models NEVER enter a free router.
--   * `routers` stores public admin routers (`owner_user_id IS NULL`) and user
--     routers (`owner_user_id = auth.uid()`). Router names are 2–32 chars and
--     case-insensitively unique within their owner scope.
--   * `router_members` links a router to `catalog_models` (admin public router)
--     or `user_models` (user router). Deleting a model cascades automatically;
--     disabling or changing pricing away from 'free' removes the membership via
--     trigger so routers stay synchronized immediately.
--   * Zero API keys or provider base URLs live in these tables.

-- ---------------------------------------------------------------------------
-- 1. Explicit pricing field on catalog_models and user_models
-- ---------------------------------------------------------------------------
alter table public.catalog_models
  add column if not exists pricing text not null default 'unknown'
    check (pricing in ('free', 'paid', 'unknown'));

-- Backfill existing catalog_models conservatively from explicit columns only.
update public.catalog_models
set pricing = case
  when coalesce(site_paid, false) = true then 'paid'
  when tier = 'free' then 'free'
  when tier = 'paid' then 'paid'
  else 'unknown'
end
where pricing = 'unknown';

alter table public.user_models
  add column if not exists pricing text not null default 'unknown'
    check (pricing in ('free', 'paid', 'unknown'));

create index if not exists catalog_models_pricing_idx
  on public.catalog_models (provider_id, pricing)
  where enabled = true;

create index if not exists user_models_pricing_idx
  on public.user_models (user_provider_id, pricing)
  where enabled = true;

-- ---------------------------------------------------------------------------
-- 2. Routers table (owner_user_id IS NULL => public admin router)
-- ---------------------------------------------------------------------------
create table if not exists public.routers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.profiles (id) on delete cascade,
  provider_id uuid references public.providers (id) on delete cascade,
  user_provider_id uuid references public.user_providers (id) on delete cascade,
  name text not null check (
    char_length(trim(name)) between 2 and 32
    and name !~ '[\x00-\x1F\x7F]'
  ),
  type text not null default 'free' check (type in ('free')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (owner_user_id is null and provider_id is not null and user_provider_id is null)
    or (owner_user_id is not null and user_provider_id is not null and provider_id is null)
  )
);

-- Uniqueness of (owner, lower(name)) for both public admin and per-user scopes
create unique index if not exists routers_public_name_uidx
  on public.routers (lower(trim(name)))
  where owner_user_id is null;

create unique index if not exists routers_user_name_uidx
  on public.routers (owner_user_id, lower(trim(name)))
  where owner_user_id is not null;

create index if not exists routers_owner_idx on public.routers (owner_user_id);
create index if not exists routers_provider_idx on public.routers (provider_id);
create index if not exists routers_user_provider_idx on public.routers (user_provider_id);

alter table public.routers enable row level security;

drop policy if exists "routers: read public or own" on public.routers;
create policy "routers: read public or own"
  on public.routers for select
  to authenticated
  using (owner_user_id is null or owner_user_id = auth.uid());

drop policy if exists "routers: read public anon" on public.routers;
create policy "routers: read public anon"
  on public.routers for select
  to anon
  using (owner_user_id is null and enabled = true);

drop policy if exists "routers: insert own" on public.routers;
create policy "routers: insert own"
  on public.routers for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists "routers: update own" on public.routers;
create policy "routers: update own"
  on public.routers for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "routers: delete own" on public.routers;
create policy "routers: delete own"
  on public.routers for delete
  to authenticated
  using (owner_user_id = auth.uid());

drop trigger if exists routers_touch on public.routers;
create trigger routers_touch before update on public.routers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Router members table
-- ---------------------------------------------------------------------------
create table if not exists public.router_members (
  id uuid primary key default gen_random_uuid(),
  router_id uuid not null references public.routers (id) on delete cascade,
  catalog_model_id uuid references public.catalog_models (id) on delete cascade,
  user_model_id uuid references public.user_models (id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  check ((catalog_model_id is not null)::int + (user_model_id is not null)::int = 1)
);

create unique index if not exists router_members_catalog_uidx
  on public.router_members (router_id, catalog_model_id)
  where catalog_model_id is not null;

create unique index if not exists router_members_user_uidx
  on public.router_members (router_id, user_model_id)
  where user_model_id is not null;

create index if not exists router_members_router_pos_idx
  on public.router_members (router_id, position asc);

alter table public.router_members enable row level security;

drop policy if exists "router_members: read public or own" on public.router_members;
create policy "router_members: read public or own"
  on public.router_members for select
  to authenticated
  using (
    exists (
      select 1 from public.routers r
      where r.id = router_members.router_id
        and (r.owner_user_id is null or r.owner_user_id = auth.uid())
    )
  );

drop policy if exists "router_members: read public anon" on public.router_members;
create policy "router_members: read public anon"
  on public.router_members for select
  to anon
  using (
    exists (
      select 1 from public.routers r
      where r.id = router_members.router_id
        and r.owner_user_id is null
        and r.enabled = true
    )
  );

drop policy if exists "router_members: manage own" on public.router_members;
create policy "router_members: manage own"
  on public.router_members for all
  to authenticated
  using (
    exists (
      select 1 from public.routers r
      where r.id = router_members.router_id
        and r.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.routers r
      where r.id = router_members.router_id
        and r.owner_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Automatic sync triggers: remove non-free or disabled models from routers
-- ---------------------------------------------------------------------------
create or replace function public.sync_catalog_model_router_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- If a model is disabled, unverified, paid, or unknown, immediately remove it
  -- from every free router.
  if (new.enabled = false or new.upstream_verified = false or new.pricing <> 'free' or coalesce(new.site_paid, false) = true) then
    delete from public.router_members
    where catalog_model_id = new.id
      and exists (select 1 from public.routers r where r.id = router_members.router_id and r.type = 'free');
  else
    -- If a free model is added/re-enabled on a provider that has a free router, attach it.
    insert into public.router_members (router_id, catalog_model_id, position, enabled)
    select
      r.id,
      new.id,
      coalesce((select max(rm.position) + 1 from public.router_members rm where rm.router_id = r.id), 0),
      true
    from public.routers r
    where r.owner_user_id is null
      and r.provider_id = new.provider_id
      and r.type = 'free'
    on conflict (router_id, catalog_model_id) where catalog_model_id is not null do update
      set enabled = true;
  end if;
  return new;
end;
$$;

drop trigger if exists catalog_models_router_sync on public.catalog_models;
create trigger catalog_models_router_sync
  after insert or update of enabled, upstream_verified, pricing, site_paid
  on public.catalog_models
  for each row execute function public.sync_catalog_model_router_membership();

create or replace function public.sync_user_model_router_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.enabled = false or new.pricing <> 'free') then
    delete from public.router_members
    where user_model_id = new.id
      and exists (select 1 from public.routers r where r.id = router_members.router_id and r.type = 'free');
  else
    insert into public.router_members (router_id, user_model_id, position, enabled)
    select
      r.id,
      new.id,
      coalesce((select max(rm.position) + 1 from public.router_members rm where rm.router_id = r.id), 0),
      true
    from public.routers r
    where r.owner_user_id = new.user_id
      and r.user_provider_id = new.user_provider_id
      and r.type = 'free'
    on conflict (router_id, user_model_id) where user_model_id is not null do update
      set enabled = true;
  end if;
  return new;
end;
$$;

drop trigger if exists user_models_router_sync on public.user_models;
create trigger user_models_router_sync
  after insert or update of enabled, pricing
  on public.user_models
  for each row execute function public.sync_user_model_router_membership();


