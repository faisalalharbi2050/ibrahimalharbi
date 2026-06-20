-- Sequential, non-reusing advertising request numbers (AB-1, AB-2, ...).
-- The sequence never rolls back on delete, so numbers are never reused.

-- 1) Monotonic sequence + per-row sequence column.
create sequence if not exists public.collab_request_seq;

alter table public.collab_requests
  add column if not exists seq bigint;

-- 2) Backfill existing rows in chronological order (oldest = 1).
with ordered as (
  select id, row_number() over (order by created_at asc, id asc) as rn
  from public.collab_requests
  where seq is null
)
update public.collab_requests c
set seq = ordered.rn
from ordered
where c.id = ordered.id;

-- 3) Advance the sequence past any backfilled values.
select setval(
  'public.collab_request_seq',
  greatest((select coalesce(max(seq), 0) from public.collab_requests), 1),
  true
);

-- 4) New rows draw the next sequence value automatically.
alter table public.collab_requests
  alter column seq set default nextval('public.collab_request_seq');

-- 5) Derive the human request number from the sequence on insert.
--    Column defaults are materialised before BEFORE-ROW triggers fire,
--    so new.seq is populated here even when the client omits it.
create or replace function public.set_collab_request_no()
returns trigger
language plpgsql
as $$
begin
  if new.seq is null then
    new.seq := nextval('public.collab_request_seq');
  end if;
  new.request_no := 'AB-' || new.seq::text;
  return new;
end;
$$;

drop trigger if exists collab_requests_set_request_no on public.collab_requests;
create trigger collab_requests_set_request_no
before insert on public.collab_requests
for each row
execute function public.set_collab_request_no();

-- 6) Normalise the backfilled rows to the AB-<seq> format as well.
update public.collab_requests
set request_no = 'AB-' || seq::text
where seq is not null;
