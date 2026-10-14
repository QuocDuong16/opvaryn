#!/bin/sh
#
# Dumps the OPVARYN database, verifies the dump is readable, and prunes old ones.
#
# Runs inside the PostgreSQL image (see the `backup` service in
# deployments/docker-compose.yml), where pg_dump always matches the server
# version. It uses only POSIX sh and the pg_* tools that image ships.
#
# Environment:
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE  connection (set by compose)
#   BACKUP_DIR            where dumps are written (default /backups)
#   BACKUP_KEEP           how many dumps to keep (default 14)
#
# A dump is only reported as written after `pg_restore --list` reads it back:
# a truncated file that looks fine on disk is the failure mode this guards
# against (docs/ops-runbook.md).
#
# Usage: sh scripts/backup-db.sh   (or: make backup)
set -eu

backup_dir="${BACKUP_DIR:-/backups}"
keep="${BACKUP_KEEP:-14}"
database="${PGDATABASE:-opvaryn}"

mkdir -p "$backup_dir"

stamp="$(date +%Y%m%d-%H%M%S)"
target="$backup_dir/opvaryn-$stamp.dump"

echo "backup: dumping $database to $target"
# Custom format (-Fc): compressed, restorable table-by-table, readable by pg_restore.
pg_dump --format=custom --no-owner --no-privileges --file="$target" "$database"

if ! pg_restore --list "$target" >/dev/null 2>&1; then
  echo "backup: FAIL: the dump cannot be read back by pg_restore; keeping it for inspection" >&2
  exit 1
fi

size="$(du -h "$target" | cut -f1)"
echo "backup: wrote $target ($size) and verified it with pg_restore --list"

# Retention: keep the newest $keep dumps, delete the rest. The count is taken
# after the write, so a failed run never deletes anything.
count="$(find "$backup_dir" -maxdepth 1 -name 'opvaryn-*.dump' -type f | wc -l | tr -d ' ')"
if [ "$count" -gt "$keep" ]; then
  echo "backup: pruning $((count - keep)) old dump(s), keeping $keep"
  find "$backup_dir" -maxdepth 1 -name 'opvaryn-*.dump' -type f | sort | head -n "$((count - keep))" |
    while read -r old; do
      rm -f "$old"
      echo "backup: removed ${old##*/}"
    done
fi
