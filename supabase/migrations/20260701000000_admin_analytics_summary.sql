-- Server-side analytics summary for the admin dashboard.
-- Keeps the browser from downloading every click row as traffic grows.

create index if not exists clicks_ts_link_id_idx
  on public.clicks (ts desc, link_id);

create index if not exists clicks_geo_period_idx
  on public.clicks (ts desc, country, region, city);

create index if not exists collab_requests_created_status_idx
  on public.collab_requests (created_at desc, status, archived);

create or replace function public.admin_analytics_summary(p_days integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_current_start timestamptz := case
    when p_days is null then '1970-01-01 00:00:00+00'::timestamptz
    else v_now - make_interval(days => greatest(p_days, 1))
  end;
  v_previous_start timestamptz := case
    when p_days is null then null
    else v_now - make_interval(days => greatest(p_days, 1) * 2)
  end;
  v_chart_days integer := case
    when p_days is null then 30
    else least(greatest(p_days, 1), 30)
  end;
  v_current_visits integer := 0;
  v_previous_visits integer := 0;
  v_visitor_total integer := 0;
  v_current_clicks integer := 0;
  v_previous_clicks integer := 0;
  v_current_requests integer := 0;
  v_previous_requests integer := 0;
  v_statuses jsonb := '{}'::jsonb;
  v_series jsonb := '[]'::jsonb;
  v_current_link_counts jsonb := '[]'::jsonb;
  v_cumulative_link_counts jsonb := '[]'::jsonb;
  v_top_locations jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
begin
  if not public.has_platform_section('analytics') then
    raise exception 'analytics access required' using errcode = '42501';
  end if;

  select coalesce(count, 0)
    into v_visitor_total
  from public.visitors
  where id = 'counter';

  if p_days is null then
    v_current_visits := coalesce(v_visitor_total, 0);
  else
    select coalesce(sum(visits), 0)::integer
      into v_current_visits
    from public.daily_visits
    where visit_date >= (v_current_start at time zone 'Asia/Riyadh')::date;

    select coalesce(sum(visits), 0)::integer
      into v_previous_visits
    from public.daily_visits
    where visit_date >= (v_previous_start at time zone 'Asia/Riyadh')::date
      and visit_date < (v_current_start at time zone 'Asia/Riyadh')::date;
  end if;

  select count(*)::integer
    into v_current_clicks
  from public.clicks
  where coalesce(ts, created_at) >= v_current_start;

  if p_days is not null then
    select count(*)::integer
      into v_previous_clicks
    from public.clicks
    where coalesce(ts, created_at) >= v_previous_start
      and coalesce(ts, created_at) < v_current_start;
  end if;

  select count(*)::integer
    into v_current_requests
  from public.collab_requests
  where created_at >= v_current_start;

  if p_days is not null then
    select count(*)::integer
      into v_previous_requests
    from public.collab_requests
    where created_at >= v_previous_start
      and created_at < v_current_start;
  end if;

  with normalized as (
    select case
      when archived then 'archived'
      when status in ('pending', 'new') then 'new'
      when status in ('review', 'contacted', 'approved', 'rejected', 'archived') then status
      else 'new'
    end as status_key
    from public.collab_requests
    where created_at >= v_current_start
  ),
  all_statuses as (
    select unnest(array['new','review','contacted','approved','rejected','archived']) as status_key
  )
  select jsonb_object_agg(a.status_key, coalesce(n.total, 0))
    into v_statuses
  from all_statuses a
  left join (
    select status_key, count(*)::integer as total
    from normalized
    group by status_key
  ) n using (status_key);

  with days as (
    select generate_series(
      ((v_now at time zone 'Asia/Riyadh')::date - (v_chart_days - 1)),
      (v_now at time zone 'Asia/Riyadh')::date,
      interval '1 day'
    )::date as day_key
  ),
  visit_counts as (
    select visit_date, sum(visits)::integer as visits
    from public.daily_visits
    where visit_date >= ((v_now at time zone 'Asia/Riyadh')::date - (v_chart_days - 1))
    group by visit_date
  ),
  click_counts as (
    select (coalesce(ts, created_at) at time zone 'Asia/Riyadh')::date as day_key, count(*)::integer as clicks
    from public.clicks
    where coalesce(ts, created_at) >= (((v_now at time zone 'Asia/Riyadh')::date - (v_chart_days - 1))::timestamp at time zone 'Asia/Riyadh')
    group by 1
  ),
  request_counts as (
    select (created_at at time zone 'Asia/Riyadh')::date as day_key, count(*)::integer as requests
    from public.collab_requests
    where created_at >= (((v_now at time zone 'Asia/Riyadh')::date - (v_chart_days - 1))::timestamp at time zone 'Asia/Riyadh')
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', to_char(d.day_key, 'YYYY-MM-DD'),
    'visits', coalesce(v.visits, 0),
    'clicks', coalesce(c.clicks, 0),
    'requests', coalesce(r.requests, 0)
  ) order by d.day_key), '[]'::jsonb)
    into v_series
  from days d
  left join visit_counts v on v.visit_date = d.day_key
  left join click_counts c on c.day_key = d.day_key
  left join request_counts r on r.day_key = d.day_key;

  select coalesce(jsonb_agg(jsonb_build_object('id', link_id, 'count', total) order by total desc), '[]'::jsonb)
    into v_current_link_counts
  from (
    select link_id, count(*)::integer as total
    from public.clicks
    where coalesce(ts, created_at) >= v_current_start
    group by link_id
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('id', link_id, 'count', total) order by total desc), '[]'::jsonb)
    into v_cumulative_link_counts
  from (
    select link_id, count(*)::integer as total
    from public.clicks
    group by link_id
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
    'country', country,
    'region', region,
    'city', city,
    'count', total
  ) order by total desc), '[]'::jsonb)
    into v_top_locations
  from (
    select coalesce(country, '') as country,
           coalesce(region, '') as region,
           coalesce(city, '') as city,
           count(*)::integer as total
    from public.clicks
    where coalesce(ts, created_at) >= v_current_start
      and nullif(concat_ws('', country, region, city), '') is not null
    group by coalesce(country, ''), coalesce(region, ''), coalesce(city, '')
    order by total desc
    limit 10
  ) s;

  with recent_items as (
    select 'click'::text as kind,
           link_id::text as link_id,
           null::text as title,
           country,
           region,
           city,
           coalesce(ts, created_at) as event_at,
           null::text as status
    from public.clicks
    where coalesce(ts, created_at) >= v_current_start
    order by coalesce(ts, created_at) desc
    limit 80
  ),
  recent_requests as (
    select 'request'::text as kind,
           null::text as link_id,
           coalesce(plan_title, name, request_no, 'request')::text as title,
           null::text as country,
           null::text as region,
           null::text as city,
           created_at as event_at,
           case
             when archived then 'archived'
             when status in ('pending', 'new') then 'new'
             when status in ('review', 'contacted', 'approved', 'rejected', 'archived') then status
             else 'new'
           end as status
    from public.collab_requests
    where created_at >= v_current_start
    order by created_at desc
    limit 80
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', kind,
    'link_id', link_id,
    'title', title,
    'country', country,
    'region', region,
    'city', city,
    'date', event_at,
    'status', status
  ) order by event_at desc), '[]'::jsonb)
    into v_recent
  from (
    select * from recent_items
    union all
    select * from recent_requests
    order by event_at desc
    limit 60
  ) r;

  return jsonb_build_object(
    'current', jsonb_build_object(
      'visits', coalesce(v_current_visits, 0),
      'clicks', coalesce(v_current_clicks, 0),
      'requests', coalesce(v_current_requests, 0)
    ),
    'previous', case when p_days is null then null else jsonb_build_object(
      'visits', coalesce(v_previous_visits, 0),
      'clicks', coalesce(v_previous_clicks, 0),
      'requests', coalesce(v_previous_requests, 0)
    ) end,
    'statuses', coalesce(v_statuses, '{}'::jsonb),
    'series', coalesce(v_series, '[]'::jsonb),
    'currentLinkCounts', coalesce(v_current_link_counts, '[]'::jsonb),
    'cumulativeLinkCounts', coalesce(v_cumulative_link_counts, '[]'::jsonb),
    'topLocations', coalesce(v_top_locations, '[]'::jsonb),
    'recent', coalesce(v_recent, '[]'::jsonb),
    'visitorTotal', coalesce(v_visitor_total, 0)
  );
end;
$$;

revoke all on function public.admin_analytics_summary(integer) from public, anon;
grant execute on function public.admin_analytics_summary(integer) to authenticated;
