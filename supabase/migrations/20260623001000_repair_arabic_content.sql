-- Repair question-mark corruption using ASCII-only SQL transport.
create table if not exists public.site_data_history (
  id bigint generated always as identity primary key,
  site_id text not null,
  data jsonb not null,
  captured_at timestamptz not null default now(),
  changed_by uuid null
);
alter table public.site_data_history enable row level security;
revoke all on public.site_data_history from public, anon, authenticated;
grant select on public.site_data_history to authenticated;
drop policy if exists "platform admins can read site data history" on public.site_data_history;
create policy "platform admins can read site data history"
on public.site_data_history for select to authenticated
using (public.has_platform_role(array['owner','admin']));

create or replace function pg_temp.u(p_hex text)
returns text language sql immutable strict as 'select convert_from(decode(p_hex, ''hex''), ''UTF8'')';

insert into public.site_data_history(site_id,data,changed_by)
select id,data,null from public.site_data where id='main';

update public.site_data set data =
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(data,
    '{nameAr}',to_jsonb(pg_temp.u('d8a5d8a8d8b1d8a7d987d98ad98520d8a8d98620d8b9d8a8d8afd8a7d984d984d98720d8a7d984d8add8b1d8a8d98a')),true),
    '{titleAr}',to_jsonb(pg_temp.u('d983d8a7d8aad8a820c2b720d985d8a4d8abd8b120d8a5d8b3d984d8a7d985d98a')),true),
    '{bioAr}',to_jsonb(pg_temp.u('d983d8a7d8aad8a820d988d985d8a4d984d98120d988d8b5d8a7d986d8b920d985d8add8aad988d98920d987d8a7d8afd9812e')),true),
    '{collab,heroTitleAr}',to_jsonb(pg_temp.u('d984d984d8a5d8b9d984d8a7d986')),true)
where id='main';

update public.site_data set data=jsonb_set(data,'{social}',
 (select jsonb_agg(jsonb_set(item,'{label}',to_jsonb(case item->>'platform'
   when 'tiktok' then pg_temp.u('d8aad98ad98320d8aad988d983') when 'snapchat' then pg_temp.u('d8b3d986d8a7d8a820d8b4d8a7d8aa')
   when 'instagram' then pg_temp.u('d8a5d986d8b3d8aad8bad8b1d8a7d985') when 'youtube' then pg_temp.u('d98ad988d8aad98ad988d8a8')
   when 'twitter' then pg_temp.u('d8aad988d98ad8aad8b12f58') when 'telegram' then pg_temp.u('d8aad98ad984d98ad8acd8b1d8a7d985')
   when 'facebook' then pg_temp.u('d981d98ad8b320d8a8d988d983') when 'whatsapp' then pg_temp.u('d988d8a7d8aad8b3d8a7d8a8')
   else item->>'label' end),true) order by ord)
  from jsonb_array_elements(coalesce(data->'social','[]'::jsonb)) with ordinality s(item,ord)),true)
where id='main';

update public.site_data set data=jsonb_set(data,'{books}',
 (select jsonb_agg(
   case item->>'id'
    when 'mqjc84bttva' then jsonb_set(jsonb_set(jsonb_set(jsonb_set(item,
      '{titleAr}',to_jsonb(pg_temp.u('d984d8a3d98620d8a7d984d984d98720d984d8a720d98ad8aed8b0d984')),true),
      '{titleEn}',to_jsonb('Because God Never Forsakes'::text),true),
      '{publisherAr}',to_jsonb(pg_temp.u('d985d984d987d985d988d986')),true),
      '{publisherEn}',to_jsonb('Molhimon'::text),true)
    when 'mqjcblllw2s' then jsonb_set(jsonb_set(jsonb_set(jsonb_set(item,
      '{titleAr}',to_jsonb(pg_temp.u('d985d98ad8aa20d8afd985d8a7d8bad98ad98bd8a7202d20d8a7d984d982d8b1d8a2d98620d8bad98ad8b1d986d98a')),true),
      '{titleEn}',to_jsonb('Brain-Dead - The Quran Changed Me'::text),true),
      '{publisherAr}',to_jsonb(pg_temp.u('d8a7d984d8b1d98ad8a7d8afd8a9')),true),
      '{publisherEn}',to_jsonb('Al-Riyada'::text),true)
    else item end order by ord)
  from jsonb_array_elements(coalesce(data->'books','[]'::jsonb)) with ordinality b(item,ord)),true)
where id='main';

update public.site_data set data=jsonb_set(data,'{books}',
 (select jsonb_agg(jsonb_set(item,'{links}',
   (select coalesce(jsonb_agg(jsonb_set(link,'{label}',to_jsonb(pg_temp.u('d8b4d8b1d8a7d8a1')),true) order by lord),'[]'::jsonb)
    from jsonb_array_elements(coalesce(item->'links','[]'::jsonb)) with ordinality l(link,lord)),true) order by ord)
  from jsonb_array_elements(coalesce(data->'books','[]'::jsonb)) with ordinality b(item,ord)),true)
where id='main';

update public.site_data set data=jsonb_set(data,'{adLinks}',
 (select jsonb_agg(
   case item->>'id'
    when 'mqjcfyokuxc' then jsonb_set(jsonb_set(jsonb_set(jsonb_set(item,
      '{titleAr}',to_jsonb(pg_temp.u('d983d981d8a7d984d8a920313520d98ad8aad98ad985')),true),
      '{titleEn}',to_jsonb('Sponsor 15 Orphans'::text),true),
      '{entityAr}',to_jsonb(pg_temp.u('d8acd985d8b9d98ad8a920d986d987d8ac')),true),
      '{entityEn}',to_jsonb('Nahj Association'::text),true)
    when 'mqngoqamwoe' then jsonb_set(jsonb_set(jsonb_set(jsonb_set(item,
      '{titleAr}',to_jsonb(pg_temp.u('d8add8a7d984d8a920d8b9d8a7d8acd984d8a9')),true),
      '{titleEn}',to_jsonb('Urgent Case'::text),true),
      '{entityAr}',to_jsonb(pg_temp.u('d8a3d981d982')),true),
      '{entityEn}',to_jsonb('Ufuq'::text),true)
    else item end order by ord)
  from jsonb_array_elements(coalesce(data->'adLinks','[]'::jsonb)) with ordinality a(item,ord)),true)
where id='main';

update public.site_data set data=jsonb_set(data,'{permissions}',
 (select jsonb_agg(jsonb_set(item,'{name}',to_jsonb(case item->>'contact'
   when 'hralharbi93@gmail.com' then pg_temp.u('d8a5d8a8d8b1d8a7d987d98ad98520d8a7d984d8add8b1d8a8d98a') else item->>'contact' end),true) order by ord)
  from jsonb_array_elements(coalesce(data->'permissions','[]'::jsonb)) with ordinality p(item,ord)),true)
where id='main';

update public.site_data set data=jsonb_set(data,'{collab,requests}',
 (select coalesce(jsonb_agg(case when item::text ~ '[?]{3,}' then
   jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(item,
    '{name}',to_jsonb(coalesce(item->>'requestNo',item->>'request_no','Request')::text),true),
    '{company}',to_jsonb(pg_temp.u('d8aad8b9d8b0d8b120d8a7d8b3d8aad8b9d8a7d8afd8a920d8a7d984d986d8b520d8a7d984d8a3d8b5d984d98a')),true),
    '{product}',to_jsonb(pg_temp.u('d8aad8b9d8b0d8b120d8a7d8b3d8aad8b9d8a7d8afd8a920d8a7d984d986d8b520d8a7d984d8a3d8b5d984d98a')),true),
    '{platforms}',to_jsonb(pg_temp.u('d8aad8b9d8b0d8b120d8a7d8b3d8aad8b9d8a7d8afd8a920d8a7d984d986d8b520d8a7d984d8a3d8b5d984d98a')),true),
    '{notes}',to_jsonb(pg_temp.u('d8aad8b9d8b0d8b120d8a7d8b3d8aad8b9d8a7d8afd8a920d8a7d984d986d8b520d8a7d984d8a3d8b5d984d98a20d8a8d8b3d8a8d8a820d8aad984d98120d8aad8b1d985d98ad8b220d8b3d8a7d8a8d982')),true)
   else item end order by ord),'[]'::jsonb)
  from jsonb_array_elements(coalesce(data#>'{collab,requests}','[]'::jsonb)) with ordinality r(item,ord)),true)
where id='main';

create or replace function public.reject_corrupted_site_data()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.data::text ~ '[?]{3,}' then
   raise exception 'site_data contains suspicious replacement characters';
 end if;
 return new;
end;
$$;

create or replace function public.archive_site_data_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.data is distinct from new.data then
   insert into public.site_data_history(site_id,data,changed_by) values(old.id,old.data,auth.uid());
   delete from public.site_data_history h where h.site_id=old.id and h.id not in
    (select id from public.site_data_history where site_id=old.id order by captured_at desc,id desc limit 50);
 end if;
 return new;
end;
$$;

drop trigger if exists site_data_reject_corruption on public.site_data;
create trigger site_data_reject_corruption before insert or update on public.site_data
for each row execute function public.reject_corrupted_site_data();
drop trigger if exists site_data_archive_change on public.site_data;
create trigger site_data_archive_change before update on public.site_data
for each row execute function public.archive_site_data_change();
