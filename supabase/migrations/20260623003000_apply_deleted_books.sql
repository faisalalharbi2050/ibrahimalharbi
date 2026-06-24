-- Apply the administrator's confirmed deletion of all published books.
update public.site_data
set data=jsonb_set(data,'{books}','[]'::jsonb,true)
where id='main';
