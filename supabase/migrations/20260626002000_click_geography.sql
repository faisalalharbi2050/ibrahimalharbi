-- Store approximate click geography without storing raw IP addresses.
alter table public.clicks
  add column if not exists country text,
  add column if not exists country_code text,
  add column if not exists region text,
  add column if not exists city text,
  add column if not exists timezone text,
  add column if not exists geo_source text;

create index if not exists clicks_country_code_idx on public.clicks (country_code);
create index if not exists clicks_city_idx on public.clicks (city);

create table if not exists public.public_geo_cache (
  ip_hash text primary key,
  country text,
  country_code text,
  region text,
  city text,
  timezone text,
  geo_source text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.public_geo_cache enable row level security;
revoke all on public.public_geo_cache from public, anon, authenticated;
grant select, insert, update, delete on public.public_geo_cache to service_role;
create index if not exists public_geo_cache_expiry_idx on public.public_geo_cache (expires_at);

create or replace function public.purge_expired_public_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.public_rate_limits where expires_at <= now();
  delete from public.public_geo_cache where expires_at <= now();
  delete from public.event_rate_limits where created_at < now() - interval '24 hours';
  delete from public.clicks where coalesce(ts, created_at) < now() - interval '90 days';
  delete from public.collab_requests
  where (status <> 'approved' and updated_at < now() - interval '12 months')
     or (status = 'approved' and updated_at < now() - interval '5 years');
end;
$$;
revoke all on function public.purge_expired_public_data() from public, anon, authenticated;
grant execute on function public.purge_expired_public_data() to service_role;
