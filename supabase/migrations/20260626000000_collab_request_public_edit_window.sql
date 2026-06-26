-- Temporary public edit window for advertising request submitters.
alter table public.collab_requests
  add column if not exists edit_token_hash text,
  add column if not exists editable_until timestamptz;

create index if not exists collab_requests_edit_token_hash_idx
  on public.collab_requests (edit_token_hash)
  where edit_token_hash is not null;

create index if not exists collab_requests_editable_until_idx
  on public.collab_requests (editable_until)
  where editable_until is not null;
