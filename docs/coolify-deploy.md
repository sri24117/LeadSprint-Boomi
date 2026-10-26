# Deploying LeadSprint on Coolify

Written from a real first deploy. Every troubleshooting row below is a failure
that actually happened, with the log line that identified it.

## 1. Create the resource

| Setting | Value |
|---|---|
| Resource | Git Repository (GitHub App) → this repo, branch `main` |
| Build pack | **Dockerfile** |
| Ports Exposes | **5000** |
| Healthcheck (Coolify UI) | **Leave off.** The Dockerfile has its own `HEALTHCHECK`; Coolify logs `Custom healthcheck found in Dockerfile` and uses it. (The "needs curl or wget" warning is boilerplate and can be ignored.) |
| Auto Deploy | On |
| Replicas | **1.** The rate limiter and the internal worker are single-process by design. |

## 2. Environment variables

Set these in the application's **Environment Variables**. "Build" means the
variable must be ticked **Available at Buildtime**, because the console bakes
it into the JavaScript bundle. Changing a build variable needs a **redeploy**;
a restart is not enough.

| Variable | Build? | Notes |
|---|---|---|
| `DATABASE_URL` | no | See section 3. |
| `NODE_ENV=production` | no | The Dockerfile also sets it. Un-tick Buildtime to silence Coolify's warning. |
| `VITE_LEADSPRINT_DEMO_AUTH=false` | **yes** | `true` is refused: the image build fails, because the API ignores demo auth in production. |
| `VITE_CLERK_PUBLISHABLE_KEY` | **yes** | Without it the console says "Sign-in is not configured". |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | no | Server-side Clerk keys. |
| `CRON_SECRET` | no | `openssl rand -hex 32`. Required for every `/api/cron/*` endpoint. |
| `TRUST_PROXY=1` | no | One proxy hop (Traefik). |
| Retell / Twilio / Cal.com / SMTP / `ALERT_EMAIL` | no | See `.env.example` and `docs/leadsprint-provider-setup.md`. |
| `LEADSPRINT_DEMO_AUTH`, `LEADSPRINT_DEMO_SEED` | — | **Do not set** in production. |

## 3. `DATABASE_URL`

```
postgres://USER:PASSWORD@INTERNAL-HOSTNAME:5432/DBNAME?uselibpqcompat=true&sslmode=require
```

- **Host:** the database resource's internal name (shown on its Coolify page), never `localhost`.
- **Password:** URL-encode special characters (`@` is `%40`). Prefer a long hex password (`openssl rand -hex 24`) and avoid the problem.
- **TLS:** `pg` treats `sslmode=require` as `verify-full`, which fails against a self-signed certificate. `?uselibpqcompat=true&sslmode=require` encrypts the connection without verifying the server identity, which is appropriate on a private Docker network. For a database across the public internet, verify its CA instead. `sslmode=required` (with a `d`) is not a valid value.
- **Credentials:** Coolify applies a database's user and password only when the data volume is first created. Changing them in the UI afterwards does not change the existing database. Use the credentials the database really has (the Postgres resource page → **Postgres URL (internal)**), or change the password inside the database with `ALTER USER`.
- Never paste the URL into chat, tickets, or screenshots.

Using **Supabase** for the database instead of a Coolify-managed Postgres? See
`docs/supabase.md`, including the required step that closes Supabase's public data API.

The app refuses to start if it cannot verify its schema, and logs a `hint`
saying what to change. That is deliberate: a process that cannot reach its
database must not accept webhooks that place phone calls.

## 4. Verify a deploy

1. The deployment log ends with the new container **healthy** and **no** "rolling back" line.
2. `GET https://<domain>/api/readyz` returns 200 with `"database":"ok"` and `"auth":"clerk"`. `"auth":"unconfigured"` means the Clerk secret key is missing; `"auth":"demo"` can only happen outside production.
3. The console loads a **sign-in page**, with no red "Demo auth" banner.
4. A deep link such as `/workspace/leads` loads after a hard refresh.

`/api/healthz` is liveness only and never touches the database. Point an uptime
monitor at `/api/readyz`: it answers 503 when the database stops responding.

## 5. Scheduled tasks

Coolify **Scheduled Tasks** run a command *inside the running container*, and
the image has no `curl` or `wget`, so use `node`. Create one task per row. The
container already has `CRON_SECRET` and `PORT` in its environment.

| Task | Frequency | Path |
|---|---|---|
| process-jobs | `*/5 * * * *` | `/api/cron/process-jobs` |
| health-alerts | `*/15 * * * *` | `/api/cron/health-alerts` |
| weekly-report | `0 8 * * 1` | `/api/cron/weekly-report` |
| retention | `0 3 * * *` | `/api/cron/retention` |

Command (replace the path):

```
node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/cron/process-jobs',{method:'POST',headers:{'x-cron-secret':process.env.CRON_SECRET}}).then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Alternatively set `ENABLE_INTERNAL_WORKER=true` to dispatch queued calls every
30 seconds without a scheduled task for `process-jobs`. The other three still
need scheduled tasks.

## 6. Backups

Database resource → **Backups**: nightly to S3, 14-day retention. Then do one
**restore drill** (`docs/backup-restore.md`). An untested backup is a hope.

## 7. Security headers

The app sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy`, HSTS (production only), and `Cache-Control: no-store` on
`/api/*`, and does not send `X-Powered-By`.

It deliberately sends **no `Content-Security-Policy`**. The console loads
Clerk's hosted scripts and Tailwind's runtime styles, and a policy that has not
been exercised against a real Clerk sign-in would lock operators out. To add
one, start with `Content-Security-Policy-Report-Only`, sign in and use every
page, fix what it reports, then enforce it.

## 8. Troubleshooting

| Symptom (log line) | Cause | Fix |
|---|---|---|
| `New container is not healthy, rolling back to the old container` | The new container exited or never answered. **The site you see is the previous deploy.** Read the `Container logs:` block above that line. | Fix what the container log says. |
| `unable to verify the first certificate` / `self-signed certificate` | TLS verification against a self-signed database certificate. | Section 3, TLS. |
| `password authentication failed for user` | Wrong credentials, or the user does not exist (same message). | Section 3, Credentials. |
| `ENOTFOUND` / `ECONNREFUSED` / `connection timeout` | Wrong host or port, or not on the same Docker network. | Use the internal service name. |
| Red "Demo auth — sign-in disabled" banner | Console built with demo auth. | Build variable `VITE_LEADSPRINT_DEMO_AUTH=false`; redeploy. |
| "Sign-in is not configured" screen | No Clerk publishable key at **build** time. | Set `VITE_CLERK_PUBLISHABLE_KEY` as a build variable; redeploy. |
| Console fills with `429 Too Many Requests` | Fixed: webhook/agent/cron limiters were applied to every `/api` route. | Deploy this version or later. |
| `readyz` returns 503, `"database":"unreachable"` | The database stopped answering. | Check the database resource; the app recovers by itself. |
