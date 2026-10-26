# Running LeadSprint's database on Supabase

LeadSprint talks to Postgres with an ordinary connection string (Drizzle + `pg`), so
Supabase's managed Postgres works as the database. Supabase is only the **database**
here: the app itself (API + console) still runs as one container, for example on Coolify.
Vercel and Netlify are not suitable for the API, which is a long-running server (see
"Why not serverless" below).

## 1. Create the project

- Create a **new** project per product (do not reuse a project that holds another app's data).
- Pick the region closest to your app server and your customers. It cannot be changed later.
- The free plan pauses a project after a period of inactivity; use a paid plan for real clients.

## 2. Apply the schema

The app owns its schema through the Drizzle migrations in `lib/db/drizzle`, and applies
them itself when it boots, so on a fresh database **you can simply start the app** and it
creates everything.

If you prefer to prepare the database first (as was done for the first project), apply the
SQL files in `lib/db/drizzle/*.sql` in order, then record them in the app's journal so the
app does not try to apply them again:

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id serial PRIMARY KEY, hash text NOT NULL, created_at bigint
);
-- one row per migration file: hash = sha256 of the file's LF content,
-- created_at = the "when" of its entry in lib/db/drizzle/meta/_journal.json
```

The app can also adopt a database that already has the schema but no journal; it logs
`[db] This database already had the schema but no migration history` and records it.

## 3. Lock down the public Data API (required)

Supabase exposes tables in the `public` schema through an HTTP API that is reachable with
a public key. Tables created by SQL migrations have row-level security **off**, so without
this step anyone holding the public key could read leads, phone numbers and consent
records. LeadSprint does not use that API, so close it:

```sql
-- Row-level security on every table. With no policies, the API roles (anon,
-- authenticated) can read and write nothing; the app connects as the table owner
-- (postgres), which bypasses RLS, so it is unaffected.
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_jobs ENABLE ROW LEVEL SECURITY;

-- Defense in depth, including for tables the app creates in future migrations.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
```

Verify it:

```sql
-- should fail with "permission denied for table leads"
begin; set local role anon; select count(*) from public.leads; rollback;
```

Supabase's security advisor should then show only informational "RLS enabled, no policies"
notes, which is the intended state. When a later migration adds a table, enable RLS on it
too. The default-privilege revokes already keep it out of the public API.

## 4. Connect the app

1. In the Supabase dashboard, set a database password (**Project Settings → Database**).
   Keep it in a password manager and never paste it into chat or a ticket.
2. Click **Connect** and copy the **Session pooler** connection string. Copy it from the
   dashboard instead of building it by hand, because the pooler host name differs by
   region and project generation.
3. In Coolify, set `DATABASE_URL` to that string with the password filled in, and end it with
   `?uselibpqcompat=true&sslmode=require` (see `docs/coolify-deploy.md`, section 3).
4. Set `DATABASE_POOL_MAX=5`, since the pooler limits client connections on small plans.
5. Redeploy. The boot log should say `Database schema up to date`.

Notes:

- The **direct** connection host (`db.<project-ref>.supabase.co`) is IPv6-only unless you buy
  the IPv4 add-on, and many servers have no IPv6. The pooler works over IPv4.
- Prefer **session** mode (port 5432) for this long-running server. Transaction mode
  (port 6543) is meant for serverless functions.

## Why not serverless (Vercel / Netlify) for the API

The API keeps rate-limit counters in memory, runs a background timer that dispatches queued
calls, and migrates the database at boot. A serverless function starts fresh on each
invocation and has no background timer, so those behaviours break. The static console can be
hosted anywhere, but the API server needs a host that keeps a process running.
