-- Guarded administrator login: three failures trigger a timed lock.
create table if not exists public.admin_login_attempts (
  key_hash text primary key,
  failures integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_login_sessions (
  session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_login_sessions_user_idx on public.admin_login_sessions(user_id);
create index if not exists admin_login_sessions_expiry_idx on public.admin_login_sessions(expires_at);
alter table public.admin_login_attempts enable row level security;
alter table public.admin_login_sessions enable row level security;
revoke all on public.admin_login_attempts from public, anon, authenticated;
revoke all on public.admin_login_sessions from public, anon, authenticated;

create or replace function public.admin_login_lock_until(p_keys text[])
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select max(locked_until)
  from public.admin_login_attempts
  where key_hash = any(p_keys) and locked_until > now();
$$;

create or replace function public.record_admin_login_failure(
  p_key text,
  p_max_attempts integer default 3,
  p_window_minutes integer default 15,
  p_lock_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.admin_login_attempts%rowtype;
  v_failures integer;
  v_locked_until timestamptz;
begin
  insert into public.admin_login_attempts(key_hash)
  values (p_key)
  on conflict (key_hash) do nothing;

  select * into v_row
  from public.admin_login_attempts
  where key_hash = p_key
  for update;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('failures', v_row.failures, 'locked_until', v_row.locked_until);
  end if;

  if v_row.window_started_at < now() - make_interval(mins => p_window_minutes) then
    v_failures := 1;
  else
    v_failures := v_row.failures + 1;
  end if;

  v_locked_until := case
    when v_failures >= p_max_attempts then now() + make_interval(mins => p_lock_minutes)
    else null
  end;

  update public.admin_login_attempts
  set failures = v_failures,
      window_started_at = case when v_failures = 1 then now() else window_started_at end,
      locked_until = v_locked_until,
      updated_at = now()
  where key_hash = p_key;

  return jsonb_build_object('failures', v_failures, 'locked_until', v_locked_until);
end;
$$;

create or replace function public.clear_admin_login_failures(p_keys text[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.admin_login_attempts where key_hash = any(p_keys);
$$;

create or replace function public.register_admin_login_session(
  p_session_id text,
  p_user_id uuid,
  p_expires_at timestamptz,
  p_ip_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.admin_login_sessions where expires_at <= now();
  insert into public.admin_login_sessions(session_id,user_id,expires_at,ip_hash)
  values (p_session_id,p_user_id,p_expires_at,p_ip_hash)
  on conflict (session_id) do update
    set user_id=excluded.user_id, expires_at=excluded.expires_at, ip_hash=excluded.ip_hash;
end;
$$;

create or replace function public.has_active_admin_login()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_login_sessions s
    where s.session_id = coalesce(auth.jwt() ->> 'session_id','')
      and s.user_id = auth.uid()
      and s.expires_at > now()
  );
$$;

create or replace function public.validate_admin_login()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.has_active_admin_login(); $$;

create or replace function public.revoke_current_admin_login()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.admin_login_sessions
  where session_id = coalesce(auth.jwt() ->> 'session_id','') and user_id = auth.uid();
$$;

create or replace function public.has_platform_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_platform_role() = any(allowed_roles)
    and public.has_active_admin_login();
$$;

revoke all on function public.admin_login_lock_until(text[]) from public, anon, authenticated;
revoke all on function public.record_admin_login_failure(text,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.clear_admin_login_failures(text[]) from public, anon, authenticated;
revoke all on function public.register_admin_login_session(text,uuid,timestamptz,text) from public, anon, authenticated;
grant execute on function public.admin_login_lock_until(text[]) to service_role;
grant execute on function public.record_admin_login_failure(text,integer,integer,integer) to service_role;
grant execute on function public.clear_admin_login_failures(text[]) to service_role;
grant execute on function public.register_admin_login_session(text,uuid,timestamptz,text) to service_role;
grant execute on function public.has_active_admin_login() to authenticated;
grant execute on function public.validate_admin_login() to authenticated;
grant execute on function public.revoke_current_admin_login() to authenticated;