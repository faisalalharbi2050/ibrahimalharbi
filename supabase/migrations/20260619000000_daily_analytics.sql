-- Daily analytics required by the redesigned dashboard.
create table if not exists public.daily_visits (
  visit_date date primary key,
  visits integer not null default 0 check (visits >= 0),
  updated_at timestamptz not null default now()
);

alter table public.daily_visits enable row level security;

drop policy if exists "analytics staff can read daily visits" on public.daily_visits;
create policy "analytics staff can read daily visits"
on public.daily_visits for select to authenticated
using (public.has_platform_role(array['owner','admin','analyst']));

drop policy if exists "owners can delete daily visits" on public.daily_visits;
create policy "owners can delete daily visits"
on public.daily_visits for delete to authenticated
using (public.has_platform_role(array['owner','admin']));

create or replace function public.record_daily_visit(p_visit_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total integer;
begin
  insert into public.daily_visits (visit_date, visits, updated_at)
  values (p_visit_date, 1, now())
  on conflict (visit_date) do update
    set visits = public.daily_visits.visits + 1,
        updated_at = now();

  insert into public.visitors (id, count, updated_at)
  values ('counter', 1, now())
  on conflict (id) do update
    set count = public.visitors.count + 1,
        updated_at = now()
  returning count into new_total;

  return new_total;
end;
$$;

revoke all on function public.record_daily_visit(date) from public, anon, authenticated;
grant execute on function public.record_daily_visit(date) to service_role;
grant select, insert, update on public.daily_visits to service_role;
grant select, delete on public.daily_visits to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.daily_visits;
exception
  when duplicate_object then null;
end $$;

