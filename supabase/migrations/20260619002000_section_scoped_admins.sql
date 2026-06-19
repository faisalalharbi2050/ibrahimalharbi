-- Full or section-scoped administrators. A selected section grants complete
-- operational access inside that section while the owner remains the only
-- account that can create or remove administrators.
create or replace function public.has_platform_section(required_section text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_platform_role(array['owner','admin'])
    or (
      public.has_platform_role(array['editor'])
      and coalesce(auth.jwt() -> 'app_metadata' -> 'sections', '[]'::jsonb) ? required_section
    );
$$;

revoke all on function public.has_platform_section(text) from public, anon;
grant execute on function public.has_platform_section(text) to authenticated;

-- Advertising requests: full management for users assigned the requests section.
drop policy if exists "authorized staff can read advertising requests" on public.collab_requests;
drop policy if exists "authorized staff can update advertising requests" on public.collab_requests;
drop policy if exists "administrators can delete advertising requests" on public.collab_requests;
create policy "section staff can read advertising requests"
on public.collab_requests for select to authenticated
using (public.has_platform_section('requests'));
create policy "section staff can update advertising requests"
on public.collab_requests for update to authenticated
using (public.has_platform_section('requests'))
with check (public.has_platform_section('requests'));
create policy "section staff can delete advertising requests"
on public.collab_requests for delete to authenticated
using (public.has_platform_section('requests'));

-- Analytics: viewing, clearing, and resetting counters are all included.
drop policy if exists "authorized staff can read click analytics" on public.clicks;
drop policy if exists "administrators can delete click analytics" on public.clicks;
create policy "section staff can read click analytics"
on public.clicks for select to authenticated
using (public.has_platform_section('analytics'));
create policy "section staff can delete click analytics"
on public.clicks for delete to authenticated
using (public.has_platform_section('analytics'));

drop policy if exists "analytics staff can read daily visits" on public.daily_visits;
drop policy if exists "owners can delete daily visits" on public.daily_visits;
create policy "section staff can read daily visits"
on public.daily_visits for select to authenticated
using (public.has_platform_section('analytics'));
create policy "section staff can delete daily visits"
on public.daily_visits for delete to authenticated
using (public.has_platform_section('analytics'));

drop policy if exists "administrators can manage visitor counter" on public.visitors;
create policy "section staff can manage visitor counter"
on public.visitors for all to authenticated
using (public.has_platform_section('analytics'))
with check (public.has_platform_section('analytics'));