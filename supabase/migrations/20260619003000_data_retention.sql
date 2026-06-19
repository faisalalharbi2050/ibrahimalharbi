-- Enforce the retention periods stated in the privacy notice.
create or replace function public.purge_expired_public_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.event_rate_limits where created_at < now() - interval '24 hours';
  delete from public.clicks where coalesce(ts, created_at) < now() - interval '90 days';
  delete from public.collab_requests
  where (status <> 'approved' and updated_at < now() - interval '12 months')
     or (status = 'approved' and updated_at < now() - interval '5 years');
end;
$$;
revoke all on function public.purge_expired_public_data() from public, anon, authenticated;
grant execute on function public.purge_expired_public_data() to service_role;