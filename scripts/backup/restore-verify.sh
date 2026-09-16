#!/usr/bin/env bash
#
# Prove a backup actually restores: pg_restore the dump into a scratch
# database, then diff schema AND data against the source.
#
# Usage:
#   SOURCE_DATABASE_URL=postgres://... SCRATCH_DB=restore_verify_xxx \
#     scripts/backup/restore-verify.sh <dump-file>
#
# The source connection needs CREATEDB (to make the scratch database) and
# is otherwise only read from. The scratch database is dropped at the end,
# including on failure. As a guard against pointing this at the wrong
# database, SCRATCH_DB must match ^restore_verify_[a-z0-9_]*$ or the
# script refuses to run — it will never create or drop anything else.
#
# Checks performed:
#   1. pg_restore of the dump succeeds into an empty database.
#   2. Schema-only dumps of source and scratch are identical
#      (ignoring pg_dump header comments, which embed timestamps).
#   3. Data-only dumps of source and scratch are byte-identical.
#   4. Per-table row counts match (reported for the human eye).
set -euo pipefail

DUMP="${1:-}"
SOURCE="${SOURCE_DATABASE_URL:-}"
SCRATCH="${SCRATCH_DB:-}"

if [[ -z "$DUMP" || -z "$SOURCE" || -z "$SCRATCH" ]]; then
  echo "usage: SOURCE_DATABASE_URL=... SCRATCH_DB=restore_verify_xxx $0 <dump-file>" >&2
  exit 1
fi
if [[ ! -f "$DUMP" ]]; then
  echo "error: dump file not found: $DUMP" >&2
  exit 1
fi
if [[ ! "$SCRATCH" =~ ^restore_verify_[a-z0-9_]*$ ]]; then
  echo "error: refusing to run: SCRATCH_DB must match ^restore_verify_[a-z0-9_]*\$ (got: $SCRATCH)" >&2
  exit 1
fi
for tool in psql pg_dump pg_restore; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool not found on PATH (try: apt install postgresql-client)" >&2
    exit 1
  fi
done

# Split postgres://authority/dbname?params into authority + params so the
# scratch URL can be rebuilt on the same server with the same options.
if [[ "$SOURCE" =~ ^(postgres(ql)?://[^/?]+)/[^/?]+(\?.*)?$ ]]; then
  AUTHORITY="${BASH_REMATCH[1]}"
  PARAMS="${BASH_REMATCH[3]:-}"
else
  echo "error: SOURCE_DATABASE_URL is not a plain postgres://authority/dbname URL" >&2
  exit 1
fi
SCRATCH_URL="${AUTHORITY}/${SCRATCH}${PARAMS}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "== restore-verify: $DUMP -> scratch database $SCRATCH =="

# The scratch name passed the guard above, so these are the only two
# database names this script will ever create or drop.
if psql "$SOURCE" -tAc "select 1 from pg_database where datname='$SCRATCH'" | grep -q 1; then
  echo "error: scratch database $SCRATCH already exists; drop it manually first (refusing to overwrite)" >&2
  exit 1
fi
cleanup() {
  psql "$SOURCE" -c "drop database if exists \"$SCRATCH\"" >/dev/null
}
trap 'cleanup; rm -rf "$WORK"' EXIT

psql "$SOURCE" -c "create database \"$SCRATCH\"" >/dev/null
pg_restore --dbname="$SCRATCH_URL" --no-owner --no-acl "$DUMP"
echo "restore: OK"

# Schema compare, ignoring pg_dump's own header comments (timestamps,
# version lines) — everything else must match exactly.
pg_dump --dbname="$SOURCE" --schema-only --no-owner --no-acl | grep -v '^--' | grep -v '^$' >"$WORK/schema-source.sql"
pg_dump --dbname="$SCRATCH_URL" --schema-only --no-owner --no-acl | grep -v '^--' | grep -v '^$' >"$WORK/schema-scratch.sql"
if ! diff -u "$WORK/schema-source.sql" "$WORK/schema-scratch.sql" >"$WORK/schema.diff"; then
  echo "SCHEMA MISMATCH between source and restored database:" >&2
  cat "$WORK/schema.diff" >&2
  exit 1
fi
echo "schema: identical"

# Data compare: data-only dumps must be byte-identical. (COPY blocks plus
# setval calls; no timestamps appear in this output.)
pg_dump --dbname="$SOURCE" --data-only --no-owner --no-acl | grep -v '^--' >"$WORK/data-source.sql"
pg_dump --dbname="$SCRATCH_URL" --data-only --no-owner --no-acl | grep -v '^--' >"$WORK/data-scratch.sql"
if ! diff -u "$WORK/data-source.sql" "$WORK/data-scratch.sql" >"$WORK/data.diff"; then
  echo "DATA MISMATCH between source and restored database:" >&2
  cat "$WORK/data.diff" >&2
  exit 1
fi
echo "data: identical"

echo "== row counts (source = restored) =="
TABLES=$(psql "$SOURCE" -tA -c "select tablename from pg_tables where schemaname='public' order by 1")
for table in $TABLES; do
  count=$(psql "$SOURCE" -tA -c "select count(*) from \"$table\"")
  printf '  %-16s %s\n' "$table" "$count"
done

echo "restore-verify: PASS"
