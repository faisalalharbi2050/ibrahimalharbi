# Supabase secure setup

## Current scope

The project is connected for public advertising request submission and secure admin request reading.

Public visitors can insert a request into `collab_requests`.
Public visitors cannot read, update, or delete requests.
Admin reading/updating requests requires Supabase Auth login with `app_metadata.role = "admin"`.
Additional admin users can be created from the dashboard after deploying the secure Edge Function.

## Steps

1. Open Supabase SQL Editor.
2. Run the full contents of `supabase/migrations/20260618000000_launch_hardening.sql`.
3. Open the local site and submit a test advertising request.
4. Check Supabase Table Editor > `collab_requests`.
5. Create an admin user in Supabase Auth.
6. Mark the admin user with `app_metadata.role = "admin"`.
7. Open Admin > advertising requests and sign in from the database connection card.
8. Deploy `supabase/functions/create-admin-user`.
9. Add additional platform users from Admin > settings > permissions.

## Create the admin role

After creating the first admin user in Authentication, run this once in Supabase SQL Editor and replace the email:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'admin@example.com';
```

## Deploy the user creation function

The dashboard cannot safely create Supabase users with the public anon key. Deploy this Edge Function so the service role key stays inside Supabase secrets:

```bash
supabase functions deploy create-admin-user
```

After deployment, sign in to the database connection card with the first admin account. Then add new users from the dashboard permissions card by entering name, email, password, role, and sections.

## Security notes

- The anon key is public by design, but RLS policies must stay enabled.
- Never place the `service_role` key in frontend files.
- Do not disable RLS on `collab_requests`.
- Admin request reading and adding additional users works through Supabase Auth, not through the public anon session.
- Never place the `service_role` key in `index.html`, `admin/index.html`, or any frontend file.
