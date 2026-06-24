-- Atomic rolling rate limits. Keys contain salted hashes only; no raw IP or phone.
create table if not exists public.public_rate_limits (
  rate_key text primary key,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.public_rate_limits enable row level security;
revoke all on public.public_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.public_rate_limits to service_role;

create index if not exists public_rate_limits_expiry_idx on public.public_rate_limits (expires_at);

create or replace function public.consume_public_rate_limit(p_key text, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare accepted_key text;
begin
  if p_key is null or length(p_key) < 8 or p_window_seconds < 1 or p_window_seconds > 86400 then
    return false;
  end if;
  insert into public.public_rate_limits(rate_key, expires_at, updated_at)
  values (p_key, now() + make_interval(secs => p_window_seconds), now())
  on conflict (rate_key) do update
    set expires_at = excluded.expires_at, updated_at = now()
    where public.public_rate_limits.expires_at <= now()
  returning rate_key into accepted_key;
  return accepted_key is not null;
end;
$$;

revoke all on function public.consume_public_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text, integer) to service_role;

create or replace function public.purge_expired_public_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.public_rate_limits where expires_at <= now();
  delete from public.event_rate_limits where created_at < now() - interval '24 hours';
  delete from public.clicks where coalesce(ts, created_at) < now() - interval '90 days';
  delete from public.collab_requests
  where (status <> 'approved' and updated_at < now() - interval '12 months')
     or (status = 'approved' and updated_at < now() - interval '5 years');
end;
$$;
revoke all on function public.purge_expired_public_data() from public, anon, authenticated;
grant execute on function public.purge_expired_public_data() to service_role;

-- Public CDN-backed media. Only guarded content staff may mutate objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('public-media', 'public-media', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "content staff upload public media" on storage.objects;
create policy "content staff upload public media" on storage.objects for insert to authenticated
with check (bucket_id = 'public-media' and public.has_platform_role(array['owner','admin','editor']));
drop policy if exists "content staff update public media" on storage.objects;
create policy "content staff update public media" on storage.objects for update to authenticated
using (bucket_id = 'public-media' and public.has_platform_role(array['owner','admin','editor']))
with check (bucket_id = 'public-media' and public.has_platform_role(array['owner','admin','editor']));
drop policy if exists "content staff delete public media" on storage.objects;
create policy "content staff delete public media" on storage.objects for delete to authenticated
using (bucket_id = 'public-media' and public.has_platform_role(array['owner','admin','editor']));

-- Run retention deterministically every day instead of relying on visitor traffic.
create extension if not exists pg_cron with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'daily-public-data-retention';
select cron.schedule('daily-public-data-retention', '17 2 * * *', 'select public.purge_expired_public_data()');
