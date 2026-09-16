#!/usr/bin/env bash
#
# Full logical backup of a LeadSprint database (schema + data) with pg_dump.
#
# Usage:
#   DATABASE_URL=postgres://... scripts/backup/backup.sh [output-file]
#
# Requires pg_dump on PATH (any ops machine, CI runner, or `apt install
# postgresql-client`). The dump is PostgreSQL custom format: compressed,
# restorable with pg_restore, and --no-owner/--no-acl so it restores
# cleanly under whatever role owns the target database.
#
# See docs/backup-restore.md for the restore procedure and schedule.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL must be set to the database to back up" >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "error: pg_dump not found on PATH (try: apt install postgresql-client)" >&2
  exit 1
fi

OUT="${1:-leadsprint-backup-$(date -u +%Y%m%dT%H%M%SZ).dump}"

pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
SHA=$(sha256sum "$OUT" | cut -d' ' -f1)
echo "backup written: $OUT ($SIZE, sha256 $SHA)"
