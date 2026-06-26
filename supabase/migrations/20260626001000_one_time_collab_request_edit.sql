-- Allow a public advertising request edit token to be used once only.
alter table public.collab_requests
  add column if not exists edit_used_at timestamptz;

create index if not exists collab_requests_unused_edit_token_idx
  on public.collab_requests (edit_token_hash)
  where edit_token_hash is not null and edit_used_at is null;
