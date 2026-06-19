do $$
declare
  affected integer;
begin
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) ||
    '{"role":"admin","platform_role":"owner","sections":[]}'::jsonb
  where lower(email) = lower('alharbi.faisal.2050@gmail.com');

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Expected exactly one owner user, updated % rows', affected;
  end if;
end $$;
