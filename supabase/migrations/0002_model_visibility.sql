-- Per-model visibility for the public site.
--
-- `enabled` already decides whether a model is listed. `site_paid` adds the
-- second admin choice: keep the model visible in the picker with a Paid badge,
-- but never run it with the site's own keys.
alter table public.catalog_models
  add column if not exists site_paid boolean not null default false;

create index if not exists catalog_models_site_paid_idx
  on public.catalog_models (site_paid)
  where site_paid;
