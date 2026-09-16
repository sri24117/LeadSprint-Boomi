# Backup and restore

LeadSprint keeps the entire pilot record — leads, consent evidence, calls,
appointments, usage — in one PostgreSQL database. Losing it loses the
business record, so backups are a launch gate, not a nice-to-have.

## The two layers

1. **Platform backups (the real safety net).** The production database
   runs under Coolify with its scheduled-backup feature pointed at S3
   storage: nightly full backups, 14-day retention. Configure this in
   Coolify's database → Backups screen before onboarding a pilot
   customer; it is outside this repo because the schedule and the bucket
   live in the platform, not in code.
2. **Portable dumps (this repo).** `scripts/backup/backup.sh` writes a
   full logical backup (schema + data, `pg_dump` custom format) that
   restores anywhere with `pg_restore` — used for pre-migration
   snapshots, moving a pilot between hosts, and proving restores work.

## Taking a backup

```bash
DATABASE_URL=postgres://... scripts/backup/backup.sh [output-file]
```

Requires `pg_dump` on PATH (`apt install postgresql-client`). The dump
is `--no-owner --no-acl`, so it restores cleanly under whatever role
owns the target database. Copy the file somewhere that is not the
database host, and record its sha256 (printed by the script) next to it.

## Restoring

To a fresh database (new host, new pilot, disaster recovery):

```bash
# 1. Create the empty target database.
psql "$ADMIN_URL" -c 'create database leadsprint_restored'

# 2. Restore the dump into it.
pg_restore --dbname="$TARGET_URL" --no-owner --no-acl leadsprint-backup-YYYYMMDDTHHMMSSZ.dump

# 3. Point the app at it (Coolify environment variables / .env),
#    then confirm the console loads and the counts look right.
```

To replace a live database in place, stop the app first, drop and
recreate the database, then restore as above. Never restore over a
database the app is connected to.

## Proving a backup restores (do this before you need it)

```bash
SOURCE_DATABASE_URL=postgres://... SCRATCH_DB=restore_verify_YYYYMMDD \
  scripts/backup/restore-verify.sh <dump-file>
```

This restores the dump into a scratch database and diffs schema AND
data against the source, then drops the scratch database. It refuses to
run unless `SCRATCH_DB` matches `^restore_verify_[a-z0-9_]*$`, so it
cannot be mis-aimed at a live database. The source connection needs
`CREATEDB`; it is otherwise only read from.

Every CI run executes this against a scratch Postgres with the real
schema and one seeded row-chain (see the `backup-restore` job in
`.github/workflows/ci.yml`), so the scripts cannot silently bit-rot.
Re-run it by hand after any change to the schema or the scripts, and
before each pilot onboarding.

## Last exercised

2026-09-16, against PostgreSQL 16.2 with the production schema
(`drizzle-kit push`) and data written by the real API server (demo
seed: 1 business, 4 contacts/leads, 2 calls, 1 appointment,
3 activities, 2 usage rows across the rollover boundary):

```
backup written: /tmp/exercise.dump (28K, sha256 af2e7786…)
== restore-verify: /tmp/exercise.dump -> scratch database restore_verify_exercise1 ==
restore: OK
schema: identical
data: identical
== row counts (source = restored) ==
  activities       3
  appointments     1
  businesses       1
  calls            2
  contacts         4
  leads            4
  provider_events  0
  suppressions     0
  usage            2
  users            1
  workflow_jobs    0
restore-verify: PASS
```

The fresh push also confirmed the Days 9–10 tenant fix at the DDL
level: `calls_provider_call_unique` is
`(business_id, provider, provider_call_id)`.
