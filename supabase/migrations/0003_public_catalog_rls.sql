-- Public catalog + admin-only writes.
--
-- The admin panel already stores providers and models through the service-role
-- REST calls in `functions/api/admin/**` (RLS is bypassed there on purpose). This
-- migration adds the database-side guarantees the panel relies on:
--
--   * anyone (anon + authenticated) may read ONLY enabled models, and only the
--     safe columns — never a provider key and never `providers.base_url`;
--   * only an admin may write providers or models when the browser talks to
--     PostgREST directly. The server promotes ADMIN_EMAILS accounts to
--     `profiles.role = 'admin'`, so `public.is_admin()` covers both cases.
--
-- Table naming used by the app and by the API:
--   * `public.providers`      — provider catalog (id, name, base_url, enabled, …)
--   * `public.catalog_models` — the model catalog; `upstream_id` is the model id
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- Columns the API depends on (no-ops on a schema created by 0001_init.sql)
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

alter table public.providers
  add column if not exists name text,
  add column if not exists base_url text,
  add column if not exists enabled boolean not null default true;

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
  site_paid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, upstream_id)
);

alter table public.catalog_models
  add column if not exists display_name text,
  add column if not exists enabled boolean not null default false,
  add column if not exists site_paid boolean not null default false;

create index if not exists catalog_models_enabled_idx
  on public.catalog_models (enabled)
  where enabled;

-- ---------------------------------------------------------------------------
-- Admin check (profiles.role, kept in sync with ADMIN_EMAILS by the server)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.status = 'active'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.providers enable row level security;
alter table public.catalog_models enable row level security;

-- Providers: nothing public. The site reads the sanitized `/api/models`
-- response, which never contains a base URL or a key.
drop policy if exists "providers: admin read" on public.providers;
create policy "providers: admin read"
  on public.providers for select
  to authenticated
  using (public.is_admin());

drop policy if exists "providers: admin write" on public.providers;
create policy "providers: admin write"
  on public.providers for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Models: everyone reads enabled rows only; only admins write.
drop policy if exists "models: public read enabled" on public.catalog_models;
create policy "models: public read enabled"
  on public.catalog_models for select
  to anon, authenticated
  using (enabled = true);

drop policy if exists "models: admin read" on public.catalog_models;
create policy "models: admin read"
  on public.catalog_models for select
  to authenticated
  using (public.is_admin());

drop policy if exists "models: admin write" on public.catalog_models;
create policy "models: admin write"
  on public.catalog_models for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Drop the unused legacy `models` view (nothing reads it; `catalog_models` is
-- the single source of truth).
-- ---------------------------------------------------------------------------
drop view if exists public.models;
