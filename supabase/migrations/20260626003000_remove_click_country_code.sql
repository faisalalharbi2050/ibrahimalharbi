-- Remove country code storage from click geography analytics.
drop index if exists public.clicks_country_code_idx;

alter table public.clicks
  drop column if exists country_code;

alter table public.public_geo_cache
  drop column if exists country_code;
