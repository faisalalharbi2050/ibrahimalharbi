-- Secure production schema for advertising requests.
-- Run this in Supabase SQL Editor for the new project.

create extension if not exists pgcrypto;

create table if not exists public.collab_requests (
  id text primary key,
  request_no text not null,
  plan_id text,
  plan_title text default 'طلب إعلان',
  name text not null,
  phone text not null,
  company text not null,
  product text not null,
  platforms text not null,
  budget text,
  notes text not null,
  status text not null default 'new'
    check (status in ('new','review','contacted','approved','rejected')),
  archived boolean not null default false,
  internal_notes text not null default '',
  consent boolean not null default true,
  legal_acknowledgement boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collab_requests_created_at_idx
  on public.collab_requests (created_at desc);

create index if not exists collab_requests_status_idx
  on public.collab_requests (status);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists collab_requests_touch_updated_at on public.collab_requests;
create trigger collab_requests_touch_updated_at
before update on public.collab_requests
for each row
execute function public.touch_updated_at();

alter table public.collab_requests enable row level security;

alter table public.collab_requests
  drop column if exists publish_start,
  drop column if exists publish_end;

drop policy if exists "public can submit advertising requests" on public.collab_requests;
create policy "public can submit advertising requests"
on public.collab_requests
for insert
to anon
with check (
  name <> ''
  and phone <> ''
  and company <> ''
  and product <> ''
  and platforms <> ''
  and notes <> ''
  and consent is true
  and legal_acknowledgement is true
  and status = 'new'
  and archived is false
  and internal_notes = ''
);

-- Admin policies are intentionally prepared but depend on Supabase Auth.
-- After creating an admin user, set app_metadata.role = "admin" for that user.
drop policy if exists "admins can read advertising requests" on public.collab_requests;
drop policy if exists "authorized staff can read advertising requests" on public.collab_requests;
create policy "admins can read advertising requests"
on public.collab_requests
for select
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admins can update advertising requests" on public.collab_requests;
drop policy if exists "authorized staff can update advertising requests" on public.collab_requests;
create policy "admins can update advertising requests"
on public.collab_requests
for update
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admins can delete advertising requests" on public.collab_requests;
drop policy if exists "administrators can delete advertising requests" on public.collab_requests;
create policy "admins can delete advertising requests"
on public.collab_requests
for delete
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists public.visitors (
  id text primary key,
  count integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.visitors (id, count)
values ('counter', 0)
on conflict (id) do nothing;

drop trigger if exists visitors_touch_updated_at on public.visitors;
create trigger visitors_touch_updated_at
before update on public.visitors
for each row
execute function public.touch_updated_at();

alter table public.visitors enable row level security;

drop policy if exists "public can read visitor counter" on public.visitors;
create policy "public can read visitor counter"
on public.visitors
for select
to anon
using (id = 'counter');

drop policy if exists "public can update visitor counter" on public.visitors;

drop policy if exists "admins can manage visitor counter" on public.visitors;
drop policy if exists "administrators can manage visitor counter" on public.visitors;
create policy "admins can manage visitor counter"
on public.visitors
for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists public.active_sessions (
  session_id text primary key,
  last_seen timestamptz not null default now(),
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists active_sessions_last_seen_idx
  on public.active_sessions (last_seen desc);

alter table public.active_sessions enable row level security;

drop policy if exists "public can read active sessions" on public.active_sessions;
drop policy if exists "public can create active sessions" on public.active_sessions;
drop policy if exists "public can refresh active sessions" on public.active_sessions;
drop policy if exists "public can delete stale active sessions" on public.active_sessions;

drop policy if exists "admins can manage active sessions" on public.active_sessions;
drop policy if exists "administrators can manage active sessions" on public.active_sessions;
create policy "admins can manage active sessions"
on public.active_sessions
for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists public.clicks (
  id uuid primary key default gen_random_uuid(),
  link_id text not null,
  url text,
  hour integer not null check (hour between 0 and 23),
  device text,
  ts timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists clicks_ts_idx
  on public.clicks (ts desc);

create index if not exists clicks_link_id_idx
  on public.clicks (link_id);

create index if not exists clicks_hour_idx
  on public.clicks (hour);

alter table public.clicks enable row level security;

drop policy if exists "public can record clicks" on public.clicks;
drop policy if exists "public can read click analytics" on public.clicks;

drop policy if exists "admins can manage click analytics" on public.clicks;
drop policy if exists "authorized staff can read click analytics" on public.clicks;
drop policy if exists "administrators can delete click analytics" on public.clicks;
create policy "admins can manage click analytics"
on public.clicks
for all
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists public.site_data (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.site_data (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

drop trigger if exists site_data_touch_updated_at on public.site_data;
create trigger site_data_touch_updated_at
before update on public.site_data
for each row
execute function public.touch_updated_at();

alter table public.site_data enable row level security;

drop policy if exists "public can read site data" on public.site_data;
create policy "public can read site data"
on public.site_data
for select
to anon, authenticated
using (id = 'main');

drop policy if exists "authenticated users can update site data" on public.site_data;
drop policy if exists "content staff can update site data" on public.site_data;

do $$
begin
  alter publication supabase_realtime add table public.site_data;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.collab_requests;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.clicks;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.visitors;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.active_sessions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Launch hardening: authorization is enforced in PostgreSQL, not in the UI.
create or replace function public.current_platform_role()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'platform_role',
    auth.jwt() -> 'app_metadata' ->> 'role',
    ''
  );
$$;

create or replace function public.has_platform_role(allowed_roles text[])
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select public.current_platform_role() = any(allowed_roles);
$$;

-- Anonymous clients never mutate analytics/session tables directly.
drop policy if exists "public can update visitor counter" on public.visitors;
drop policy if exists "public can read active sessions" on public.active_sessions;
drop policy if exists "public can create active sessions" on public.active_sessions;
drop policy if exists "public can refresh active sessions" on public.active_sessions;
drop policy if exists "public can delete stale active sessions" on public.active_sessions;
drop policy if exists "public can record clicks" on public.clicks;
drop policy if exists "public can read click analytics" on public.clicks;

drop policy if exists "admins can read advertising requests" on public.collab_requests;
create policy "authorized staff can read advertising requests"
on public.collab_requests for select to authenticated
using (public.has_platform_role(array['owner','admin','support']));

drop policy if exists "admins can update advertising requests" on public.collab_requests;
create policy "authorized staff can update advertising requests"
on public.collab_requests for update to authenticated
using (public.has_platform_role(array['owner','admin','support']))
with check (public.has_platform_role(array['owner','admin','support']));

drop policy if exists "admins can delete advertising requests" on public.collab_requests;
create policy "administrators can delete advertising requests"
on public.collab_requests for delete to authenticated
using (public.has_platform_role(array['owner','admin']));

drop policy if exists "admins can manage visitor counter" on public.visitors;
create policy "administrators can manage visitor counter"
on public.visitors for all to authenticated
using (public.has_platform_role(array['owner','admin']))
with check (public.has_platform_role(array['owner','admin']));

drop policy if exists "admins can manage active sessions" on public.active_sessions;
create policy "administrators can manage active sessions"
on public.active_sessions for all to authenticated
using (public.has_platform_role(array['owner','admin']))
with check (public.has_platform_role(array['owner','admin']));

drop policy if exists "admins can manage click analytics" on public.clicks;
create policy "authorized staff can read click analytics"
on public.clicks for select to authenticated
using (public.has_platform_role(array['owner','admin','analyst']));
create policy "administrators can delete click analytics"
on public.clicks for delete to authenticated
using (public.has_platform_role(array['owner','admin']));

drop policy if exists "authenticated users can update site data" on public.site_data;
create policy "content staff can update site data"
on public.site_data for all to authenticated
using (id = 'main' and public.has_platform_role(array['owner','admin','editor']))
with check (id = 'main' and public.has_platform_role(array['owner','admin','editor']));

-- One row per IP hash and time bucket. Only service-role Edge Functions use it.
create table if not exists public.event_rate_limits (
  rate_key text not null,
  bucket timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (rate_key, bucket)
);

alter table public.event_rate_limits enable row level security;
revoke all on public.event_rate_limits from anon, authenticated;
revoke insert, update, delete on public.collab_requests from anon;
revoke insert, update, delete on public.clicks from anon;
revoke select, insert, update, delete on public.active_sessions from anon;
revoke update, delete on public.visitors from anon;

grant insert on public.collab_requests to service_role;
grant insert on public.clicks to service_role;
grant select, insert, delete on public.event_rate_limits to service_role;
