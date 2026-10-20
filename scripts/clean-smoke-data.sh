#!/usr/bin/env bash
#
# Removes what the smoke tests left behind in the local database.
#
# Every run of smoke-api, smoke-demo-flows and smoke-restart creates objects, definitions,
# records, instances, metrics, users and departments. They are tagged with a prefix
# (smoke_, flow_, restart_) or an @example.com address, and left alone they accumulate —
# a day of runs is enough to fill the Data screen with test objects and make the pilot data
# unreadable.
#
# Only tagged rows are touched: the pilot and demo data (`make seed-demo` — purchase_request,
# it_incident, hr_onboarding, the departments and the @opvaryn.local accounts) never matches
# a prefix. Run `make backup` first if you want a way back.
#
# Usage: bash scripts/clean-smoke-data.sh   (or: make clean-smoke-data)
#
# It needs bash, not sh: the compose invocation is kept in an array. A caller that runs it
# with sh gets a syntax error — and a smoke script that swallowed that error would quietly
# leave its rows behind, which is how the Data screen filled up with test objects.
set -eu

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
compose=(docker compose -f "$root_dir/deployments/docker-compose.yml" --project-directory "$root_dir")

psql() {
  "${compose[@]}" exec -T postgres \
    psql -U "${POSTGRES_USER:-opvaryn}" -d "${POSTGRES_DB:-opvaryn}" -v ON_ERROR_STOP=1 "$@"
}

echo "clean: removing rows the smoke tests created (smoke_/flow_/restart_ and *@example.com)"

# One transaction: instances first (they RESTRICT their definition and their record), then the
# definitions and objects the rest hangs off. Deleting an object cascades to its records, its
# published versions and the metrics defined on it.
psql <<'SQL'
BEGIN;

DELETE FROM process_instances
 WHERE definition_id IN (SELECT id FROM process_definitions WHERE key ~ '^(smoke|flow|restart)_')
    OR record_id IN (
         SELECT r.id
           FROM business_object_records r
           JOIN business_objects o ON o.id = r.object_id
          WHERE o.key ~ '^(smoke|flow|restart)_'
       );

DELETE FROM process_definitions WHERE key ~ '^(smoke|flow|restart)_';
-- Files of smoke objects, including uploads that were never attached to a record.
DELETE FROM attachments        WHERE object_key ~ '^(smoke|flow|restart)_';
-- The audit table has no foreign key (it outlives records), so it is cleaned by object key.
DELETE FROM record_audit       WHERE object_key ~ '^(smoke|flow|restart)_';
DELETE FROM login_failures     WHERE email LIKE '%@example.com';
DELETE FROM business_objects    WHERE key ~ '^(smoke|flow|restart)_';
DELETE FROM metric_definitions  WHERE key ~ '^(smoke|flow|restart)_';
DELETE FROM users               WHERE email LIKE '%@example.com';
DELETE FROM departments         WHERE key ~ '^(smoke|flow|restart)_';
-- Roles the smoke runs created (ADR 0022). Deleting the users above removed every holder;
-- the process definitions deleted earlier removed the published versions that named them.
DELETE FROM roles               WHERE key ~ '^(smoke|flow|restart)_';

COMMIT;
SQL

echo "clean: done. What is left:"
psql -c "SELECT (SELECT count(*) FROM business_objects) AS objects,
                (SELECT count(*) FROM process_definitions) AS definitions,
                (SELECT count(*) FROM process_instances) AS instances,
                (SELECT count(*) FROM users) AS users;"
