-- Privacy contact requests submitted from the Privacy Policy page.

create sequence if not exists public.privacy_request_seq;

create table if not exists public.privacy_requests (
  id text primary key,
  request_no text not null default 'pending',
  seq bigint not null default nextval('public.privacy_request_seq'),
  name text not null,
  phone text not null,
  request_type text not null default 'privacy'
    check (request_type in ('privacy')),
  details text not null,
  status text not null default 'new'
    check (status in ('new','review','contacted','closed')),
  archived boolean not null default false,
  internal_notes text not null default '',
  consent boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists privacy_requests_created_at_idx
  on public.privacy_requests (created_at desc);

create index if not exists privacy_requests_status_idx
  on public.privacy_requests (status);

create or replace function public.set_privacy_request_no()
returns trigger
language plpgsql
as $$
begin
  if new.seq is null then
    new.seq := nextval('public.privacy_request_seq');
  end if;
  new.request_no := 'PR-' || lpad(new.seq::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists privacy_requests_set_request_no on public.privacy_requests;
create trigger privacy_requests_set_request_no
before insert on public.privacy_requests
for each row
execute function public.set_privacy_request_no();

drop trigger if exists privacy_requests_touch_updated_at on public.privacy_requests;
create trigger privacy_requests_touch_updated_at
before update on public.privacy_requests
for each row
execute function public.touch_updated_at();

alter table public.privacy_requests enable row level security;

drop policy if exists "section staff can read privacy requests" on public.privacy_requests;
create policy "section staff can read privacy requests"
on public.privacy_requests for select to authenticated
using (public.has_platform_section('privacy_requests'));

drop policy if exists "section staff can update privacy requests" on public.privacy_requests;
create policy "section staff can update privacy requests"
on public.privacy_requests for update to authenticated
using (public.has_platform_section('privacy_requests'))
with check (public.has_platform_section('privacy_requests'));

drop policy if exists "section staff can delete privacy requests" on public.privacy_requests;
create policy "section staff can delete privacy requests"
on public.privacy_requests for delete to authenticated
using (public.has_platform_section('privacy_requests'));

revoke insert, update, delete on public.privacy_requests from anon;
grant insert on public.privacy_requests to service_role;

do $$
begin
  alter publication supabase_realtime add table public.privacy_requests;
exception when duplicate_object then null;
end $$;
