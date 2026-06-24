drop trigger if exists site_data_reject_corruption on public.site_data;
create or replace function pg_temp.u(p_hex text)
returns text language sql immutable strict as 'select convert_from(decode(p_hex, ''hex''), ''UTF8'')';
update public.site_data set data=jsonb_set(data,'{collab,requests}',
 (select coalesce(jsonb_agg(
   case when item->>'plan_title' ~ '[?]{3,}' then jsonb_set(item,'{plan_title}',to_jsonb(pg_temp.u('d8b7d984d8a820d8a5d8b9d984d8a7d986')),true)
        else item end order by ord),'[]'::jsonb)
  from jsonb_array_elements(coalesce(data#>'{collab,requests}','[]'::jsonb)) with ordinality r(item,ord)),true)
where id='main';
create trigger site_data_reject_corruption before insert or update on public.site_data
for each row execute function public.reject_corrupted_site_data();
