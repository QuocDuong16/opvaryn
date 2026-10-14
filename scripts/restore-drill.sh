#!/usr/bin/env bash
#
# Restore drill: proves that the newest backup actually restores into a working
# database. ADR 0008/0009 are explicit that a backup which has never been restored
# is not a backup, so this is the check that turns one into the other.
#
# What it does, all against a scratch database that is dropped at the end:
#   1. picks the newest dump (scripts/backup-db.sh writes them),
#   2. creates `opvaryn_restore_drill` in the running PostgreSQL container,
#   3. restores the dump into it,
#   4. compares row counts and schema_migrations with the source database,
#   5. creates a throwaway account in the restored copy with useradm, starts the
#      API against it and signs in — a restored database that cannot serve a login
#      and an inbox read is not usable, and this is where that shows up,
#   6. drops the scratch database and stops the API.
#
# The source database is never written to. Run it after any schema or backup
# change, and before a pilot starts on the internal host.
#
# Requires: PostgreSQL running through Docker Compose (make docker-up or
# make pilot-up) and the API built (make api-build).
#
# Usage: bash scripts/restore-drill.sh   (or: make restore-drill)
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_dir="$root_dir/apps/api"
compose=(docker compose -f "$root_dir/deployments/docker-compose.yml" --project-directory "$root_dir")

backup_dir="${BACKUP_DIR:-$root_dir/deployments/backups}"
drill_db="${RESTORE_DRILL_DB:-opvaryn_restore_drill}"
api_port="${RESTORE_DRILL_API_PORT:-21901}"
drill_email="restore-drill@opvaryn.local"
drill_password="restore-drill-password"
api_pid=""
api_log="$(mktemp -t opvaryn-restore-drill.XXXXXX.log)"

fail() {
  echo "restore-drill: FAIL: $*" >&2
  if [[ -s "$api_log" ]]; then
    echo "--- API log (last 10 lines) ---" >&2
    tail -n 10 "$api_log" >&2
  fi
  exit 1
}

cleanup() {
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill -TERM "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  # Drop the scratch database even when the drill failed: leaving it behind would
  # make the next run start from a half-restored copy.
  "${compose[@]}" exec -T postgres dropdb --if-exists --force -U "${POSTGRES_USER:-opvaryn}" "$drill_db" \
    >/dev/null 2>&1 || true
  rm -f "$api_log"
}
trap cleanup EXIT

# psql in the container, quiet tuples-only output.
query() {
  "${compose[@]}" exec -T postgres \
    psql -U "${POSTGRES_USER:-opvaryn}" -d "$1" -At -c "$2"
}

# ---------------------------------------------------------------- preflight ----

[[ -f "$api_dir/bin/server" ]] || fail "the API binary is missing — run 'make api-build' first"
[[ -f "$api_dir/bin/useradm" ]] || fail "the useradm binary is missing — run 'make api-build' first"

"${compose[@]}" ps postgres >/dev/null 2>&1 || fail "cannot read the compose state"
"${compose[@]}" exec -T postgres pg_isready -U "${POSTGRES_USER:-opvaryn}" >/dev/null 2>&1 ||
  fail "PostgreSQL is not running — start it with 'make docker-up'"

newest_dump="$(find "$backup_dir" -maxdepth 1 -name 'opvaryn-*.dump' -type f 2>/dev/null | sort | tail -n 1)"
[[ -n "$newest_dump" ]] || fail "no dump in $backup_dir — write one with 'make backup' first"

source_db="${POSTGRES_DB:-opvaryn}"
echo "restore-drill: source database $source_db, dump ${newest_dump##*/}"

if ! "${compose[@]}" exec -T postgres pg_restore --list <"$newest_dump" >/dev/null 2>&1; then
  fail "the dump cannot be read by pg_restore — the file is corrupt"
fi

# ------------------------------------------------------------------ restore ----

echo "restore-drill: creating the scratch database $drill_db"
"${compose[@]}" exec -T postgres dropdb --if-exists --force -U "${POSTGRES_USER:-opvaryn}" "$drill_db" >/dev/null
"${compose[@]}" exec -T postgres createdb -U "${POSTGRES_USER:-opvaryn}" "$drill_db" >/dev/null

echo "restore-drill: restoring"
if ! "${compose[@]}" exec -T postgres \
  pg_restore --no-owner --no-privileges --exit-on-error -U "${POSTGRES_USER:-opvaryn}" -d "$drill_db" \
  <"$newest_dump" >/dev/null; then
  fail "pg_restore reported an error; the dump does not restore cleanly"
fi

# ---------------------------------------------------------------- integrity ----

echo "restore-drill: comparing the restored copy with the source"
migrations_source="$(query "$source_db" 'SELECT count(*) FROM schema_migrations')"
migrations_restored="$(query "$drill_db" 'SELECT count(*) FROM schema_migrations')"
[[ "$migrations_source" == "$migrations_restored" ]] ||
  fail "schema_migrations differs: source $migrations_source, restored $migrations_restored"
echo "restore-drill: schema_migrations matches ($migrations_restored applied)"

for table in business_objects business_object_versions business_object_records process_definitions process_instances process_tasks users departments; do
  source_count="$(query "$source_db" "SELECT count(*) FROM $table")"
  restored_count="$(query "$drill_db" "SELECT count(*) FROM $table")"
  if [[ "$source_count" != "$restored_count" ]]; then
    fail "$table differs: source $source_count, restored $restored_count (a write during the drill can cause this — rerun)"
  fi
  echo "restore-drill: $table $restored_count row(s)"
done

# The engine's own consistency rule: every instance points at a record that exists
# and at the definition version it started with. A restore that loses either would
# break decisions later, not now, which is exactly what a drill is for.
orphans="$(query "$drill_db" 'SELECT count(*) FROM process_instances i LEFT JOIN business_object_records r ON r.id = i.record_id LEFT JOIN process_definition_versions v ON v.id = i.definition_version_id WHERE r.id IS NULL OR v.id IS NULL')"
[[ "$orphans" == "0" ]] || fail "$orphans instance(s) lost their record or definition version in the restore"
echo "restore-drill: every instance still points at its record and its definition version"

# ------------------------------------------------------------ usable by the API ----

echo "restore-drill: proving the restored copy serves a sign-in and an inbox read"
restored_url="postgres://${POSTGRES_USER:-opvaryn}:${POSTGRES_PASSWORD:-opvaryn}@localhost:${POSTGRES_PORT:-21532}/$drill_db?sslmode=disable"

# The throwaway account needs a department that exists in the restored copy; a dump
# taken before any seed has none, so one is created in that case (this database is
# dropped at the end either way).
drill_department="$(query "$drill_db" 'SELECT key FROM departments ORDER BY key LIMIT 1')"
if [[ -z "$drill_department" ]]; then
  drill_department="restore_drill"
  (cd "$api_dir" && DATABASE_URL="$restored_url" ./bin/useradm \
    -create-department -key "$drill_department" -department-name "Restore drill") >/dev/null ||
    fail "could not create a department in the restored copy"
fi

(cd "$api_dir" && DATABASE_URL="$restored_url" ./bin/useradm -create \
  -email "$drill_email" -name "Restore drill" -password "$drill_password" \
  -department "$drill_department" -roles admin) >/dev/null ||
  fail "could not create the throwaway account in the restored copy"

DATABASE_URL="$restored_url" API_PORT="$api_port" "$api_dir/bin/server" >"$api_log" 2>&1 &
api_pid=$!

for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://localhost:$api_port/readyz" 2>/dev/null; then
    break
  fi
  sleep 1
done
curl -sf -o /dev/null "http://localhost:$api_port/readyz" ||
  fail "the API did not become ready against the restored database"

cookies="$(mktemp -t opvaryn-restore-drill.XXXXXX.cookies)"
login_status="$(curl -sS -o /dev/null -w '%{http_code}' -c "$cookies" -X POST \
  "http://localhost:$api_port/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$drill_email\",\"password\":\"$drill_password\"}")"
[[ "$login_status" == "200" ]] || fail "signing in against the restored copy returned $login_status, expected 200"

inbox_status="$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookies" "http://localhost:$api_port/api/v1/tasks")"
[[ "$inbox_status" == "200" ]] || fail "reading the inbox from the restored copy returned $inbox_status, expected 200"
rm -f "$cookies"
echo "restore-drill: the restored database answers /readyz, a sign-in and the inbox read"

echo "restore-drill: PASS — ${newest_dump##*/} restores into a database the product can run on"
