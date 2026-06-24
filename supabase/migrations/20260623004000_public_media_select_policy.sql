-- Make public-media reads explicit for both the public CDN and admin-side storage operations.
-- The bucket is intentionally public; this policy documents and enforces that scope.
drop policy if exists "public can read public media" on storage.objects;
create policy "public can read public media" on storage.objects
for select
to public
using (bucket_id = 'public-media');
