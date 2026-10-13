#!/usr/bin/env bash
#
# Smoke test for the OPVARYN API: builds the server, starts it, and exercises the
# business-object vertical slice against the local PostgreSQL.
#
# Requires:
#   - PostgreSQL running (make docker-up)
#   - migrations applied (cd apps/api && go run ./cmd/migrate)
#   - no other OPVARYN API instance on the target port
#
# Usage: bash scripts/smoke-api.sh   (or: make smoke-api)
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_dir="$root_dir/apps/api"
base_url="${API_BASE_URL:-http://localhost:21501}"
log_file="$(mktemp -t opvaryn-smoke-log.XXXXXX)"
body_file="$(mktemp -t opvaryn-smoke-body.XXXXXX)"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -f "$log_file" "$body_file"
}
trap cleanup EXIT

fail() {
  echo "smoke: FAIL: $*" >&2
  if [[ -s "$log_file" ]]; then
    echo "--- server log (last 20 lines) ---" >&2
    tail -n 20 "$log_file" >&2
  fi
  exit 1
}

# request <method> <path> [json-body] -> writes body to $body_file, prints status code
request() {
  local method="$1" path="$2" json="${3:-}"
  if [[ -n "$json" ]]; then
    curl -sS -o "$body_file" -w '%{http_code}' -X "$method" "$base_url$path" \
      -H 'Content-Type: application/json' -d "$json"
  else
    curl -sS -o "$body_file" -w '%{http_code}' -X "$method" "$base_url$path"
  fi
}

echo "smoke: building the API server"
(cd "$api_dir" && go build -o bin/server ./cmd/server)

if curl -sf "$base_url/healthz" >/dev/null 2>&1; then
  fail "another server is already answering on $base_url — stop it before running the smoke test"
fi

echo "smoke: starting the API"
"$api_dir/bin/server" >"$log_file" 2>&1 &
server_pid=$!

for _ in $(seq 1 30); do
  if curl -sf "$base_url/healthz" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    fail "the API exited before becoming healthy"
  fi
  sleep 1
done

echo "smoke: GET /healthz"
[[ "$(request GET /healthz)" == "200" ]] || fail "GET /healthz did not return 200"
grep -q '"status":"ok"' "$body_file" || fail "GET /healthz body does not report ok"

echo "smoke: GET /readyz (database reachable)"
status="$(request GET /readyz)"
[[ "$status" == "200" ]] || fail "GET /readyz did not return 200 (database not migrated or not running; status $status)"

echo "smoke: GET /api/v1/meta"
[[ "$(request GET /api/v1/meta)" == "200" ]] || fail "GET /api/v1/meta did not return 200"
grep -q '"name":"OPVARYN"' "$body_file" || fail "GET /api/v1/meta does not report the product name"

object_key="smoke_$(date +%s)"
object_body="$(printf '{"key":"%s","name":"Smoke test object","description":"created by scripts/smoke-api.sh","fields":[{"key":"amount","label":"Số tiền","type":"number","required":true},{"key":"priority","label":"Mức ưu tiên","type":"select","options":[{"value":"normal","label":"Bình thường"},{"value":"urgent","label":"Gấp"}]}]}' "$object_key")"

echo "smoke: POST /api/v1/business-objects (create)"
status="$(request POST /api/v1/business-objects "$object_body")"
[[ "$status" == "201" ]] || fail "creating a business object returned $status, expected 201"
grep -q "\"key\":\"$object_key\"" "$body_file" || fail "create response does not contain the created key"
grep -q '"value":"urgent"' "$body_file" || fail "create response dropped the select options"

echo "smoke: POST /api/v1/business-objects (duplicate -> 409)"
status="$(request POST /api/v1/business-objects "$object_body")"
[[ "$status" == "409" ]] || fail "duplicate key returned $status, expected 409"
grep -q '"code":"conflict"' "$body_file" || fail "duplicate create did not return the conflict error code"

echo "smoke: POST /api/v1/business-objects (invalid input -> 400)"
status="$(request POST /api/v1/business-objects '{"key":"Not A Key","name":""}')"
[[ "$status" == "400" ]] || fail "invalid input returned $status, expected 400"
grep -q '"code":"invalid_request"' "$body_file" || fail "invalid create did not return the invalid_request error code"

echo "smoke: GET /api/v1/business-objects (list contains the created object)"
[[ "$(request GET /api/v1/business-objects)" == "200" ]] || fail "listing business objects did not return 200"
grep -q "\"key\":\"$object_key\"" "$body_file" || fail "the created object is missing from the list"

echo "smoke: GET /api/v1/business-objects/{key} (known and unknown keys)"
[[ "$(request GET "/api/v1/business-objects/$object_key")" == "200" ]] || fail "reading a business object did not return 200"
grep -q "\"key\":\"$object_key\"" "$body_file" || fail "the read object does not match the requested key"
status="$(request GET /api/v1/business-objects/smoke_missing_key)"
[[ "$status" == "404" ]] || fail "reading an unknown object returned $status, expected 404"
grep -q '"code":"not_found"' "$body_file" || fail "unknown object did not return the not_found error code"

echo "smoke: POST /api/v1/business-objects/{key}/records (create)"
status="$(request POST "/api/v1/business-objects/$object_key/records" '{"values":{"amount":1500000,"priority":"urgent"}}')"
[[ "$status" == "201" ]] || fail "creating a record returned $status, expected 201"
grep -q '"objectKey"' "$body_file" || fail "record response does not report its object key"

echo "smoke: POST records (unknown field key -> 400)"
status="$(request POST "/api/v1/business-objects/$object_key/records" '{"values":{"amount":1,"note":"not declared"}}')"
[[ "$status" == "400" ]] || fail "record with an undeclared field returned $status, expected 400"
grep -q 'field is not defined on this object' "$body_file" || fail "undeclared field was not reported as such"

echo "smoke: POST records (missing required -> 400)"
status="$(request POST "/api/v1/business-objects/$object_key/records" '{"values":{"priority":"normal"}}')"
[[ "$status" == "400" ]] || fail "record without the required field returned $status, expected 400"
grep -q '"code":"invalid_request"' "$body_file" || fail "invalid record did not return the invalid_request error code"

echo "smoke: POST records (value outside the declared options -> 400)"
status="$(request POST "/api/v1/business-objects/$object_key/records" '{"values":{"amount":10,"priority":"later"}}')"
[[ "$status" == "400" ]] || fail "record with an undeclared option returned $status, expected 400"
grep -q 'not one of the declared options' "$body_file" || fail "undeclared option was not reported as such"

echo "smoke: POST records (unknown object -> 404)"
status="$(request POST /api/v1/business-objects/smoke_missing_key/records '{"values":{}}')"
[[ "$status" == "404" ]] || fail "record for an unknown object returned $status, expected 404"

echo "smoke: GET /api/v1/business-objects/{key}/records (list contains the created record)"
[[ "$(request GET "/api/v1/business-objects/$object_key/records")" == "200" ]] || fail "listing records did not return 200"
grep -q '"amount":1500000' "$body_file" || fail "the created record is missing from the list"
grep -q '"objectVersion":1' "$body_file" || fail "a record created before any edit should be bound to version 1"

echo "smoke: PUT /api/v1/business-objects/{key} (publishes version 2)"
update_body="$(printf '{"name":"Smoke test object (v2)","description":"published by scripts/smoke-api.sh","fields":[{"key":"amount","label":"Số tiền (VND)","type":"number","required":true},{"key":"note","label":"Ghi chú","type":"text"}]}')"
status="$(request PUT "/api/v1/business-objects/$object_key" "$update_body")"
[[ "$status" == "200" ]] || fail "updating a business object returned $status, expected 200"
grep -q '"version":2' "$body_file" || fail "the update did not publish version 2"
grep -q '"key":"note"' "$body_file" || fail "the new version does not carry the new schema"

echo "smoke: PUT (invalid definition -> 400, unknown key -> 404)"
status="$(request PUT "/api/v1/business-objects/$object_key" '{"name":"","fields":[{"key":"bad key","label":"x","type":"text"}]}')"
[[ "$status" == "400" ]] || fail "invalid definition update returned $status, expected 400"
grep -q '"code":"invalid_request"' "$body_file" || fail "invalid update did not return the invalid_request error code"
status="$(request PUT /api/v1/business-objects/smoke_missing_key '{"name":"Không tồn tại"}')"
[[ "$status" == "404" ]] || fail "updating an unknown object returned $status, expected 404"
grep -q '"code":"not_found"' "$body_file" || fail "unknown object update did not return the not_found error code"

echo "smoke: POST records (after the edit -> binds to version 2)"
status="$(request POST "/api/v1/business-objects/$object_key/records" '{"values":{"amount":5000,"note":"ghi chú v2"}}')"
[[ "$status" == "201" ]] || fail "creating a record after the update returned $status, expected 201"
grep -q '"objectVersion":2' "$body_file" || fail "a new record should bind to the newest version"

echo "smoke: GET /api/v1/business-objects/{key}/versions (newest first, history intact)"
status="$(request GET "/api/v1/business-objects/$object_key/versions")"
[[ "$status" == "200" ]] || fail "listing definition versions returned $status, expected 200"
python3 - "$body_file" <<'PY' || fail "definition versions are not correctly ordered or incomplete"
import json, sys

versions = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
numbers = [version["version"] for version in versions]
if numbers != sorted(numbers, reverse=True) or numbers != [2, 1]:
    sys.exit(f"expected versions [2, 1], got {numbers}")
if any(version["publishedBy"] != "system" for version in versions):
    sys.exit("publishing should be attributed to system until identity exists")
newest = [field["key"] for field in versions[0]["fields"]]
oldest = [field["key"] for field in versions[-1]["fields"]]
if newest != ["amount", "note"] or oldest != ["amount", "priority"]:
    sys.exit(f"version schemas are wrong: newest {newest}, oldest {oldest}")
print("smoke: version history verified")
PY

echo "smoke: records keep the definition version they were created under"
status="$(request GET "/api/v1/business-objects/$object_key/records")"
[[ "$status" == "200" ]] || fail "listing records after the edit returned $status, expected 200"
python3 - "$body_file" <<'PY' || fail "records are not bound to their own definition version"
import json, sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
bound = sorted(record["objectVersion"] for record in records)
if bound != [1, 2]:
    sys.exit(f"expected one record on version 1 and one on version 2, got {bound}")

old = next(record for record in records if record["objectVersion"] == 1)
if set(old["values"]) != {"amount", "priority"}:
    sys.exit(f"the version 1 record lost its original values: {sorted(old['values'])}")
print("smoke: record version binding verified")
PY

echo "smoke: GET /api/v1/does-not-exist (unknown route -> 404 envelope)"
status="$(request GET /api/v1/does-not-exist)"
[[ "$status" == "404" ]] || fail "unknown route returned $status, expected 404"
grep -q '"code":"not_found"' "$body_file" || fail "unknown route did not return the not_found error code"

echo "smoke: PASS"
