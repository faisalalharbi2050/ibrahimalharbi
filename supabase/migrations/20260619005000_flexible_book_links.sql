-- Convert legacy fixed book URLs into an extensible links array.
update public.site_data
set data = jsonb_set(
  data,
  '{books}',
  coalesce((
    select jsonb_agg(
      (book - 'printUrl' - 'digitalUrl') ||
      jsonb_build_object(
        'links',
        case
          when jsonb_typeof(book -> 'links') = 'array'
               and jsonb_array_length(book -> 'links') > 0
            then book -> 'links'
          else
            case
              when nullif(trim(book ->> 'printUrl'), '') is not null
                then jsonb_build_array(jsonb_build_object(
                  'id', 'legacy_print',
                  'label', 'شراء',
                  'url', book ->> 'printUrl'
                ))
              else '[]'::jsonb
            end
            ||
            case
              when nullif(trim(book ->> 'digitalUrl'), '') is not null
                then jsonb_build_array(jsonb_build_object(
                  'id', 'legacy_digital',
                  'label', case
                    when nullif(trim(book ->> 'printUrl'), '') is not null then 'رابط إضافي'
                    else 'شراء'
                  end,
                  'url', book ->> 'digitalUrl'
                ))
              else '[]'::jsonb
            end
        end
      )
    )
    from jsonb_array_elements(coalesce(data -> 'books', '[]'::jsonb)) as items(book)
  ), '[]'::jsonb),
  true
)
where id = 'main';