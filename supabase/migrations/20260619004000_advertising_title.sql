-- Keep the published advertising card title aligned with the public interface.
update public.site_data
set data = jsonb_set(data::jsonb, '{collab,heroTitleAr}', to_jsonb('للإعلان'::text), true),
    updated_at = now()
where id = 'main';