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
