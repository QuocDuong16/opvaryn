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
object_body="$(printf '{"key":"%s","name":"Smoke test object","description":"created by scripts/smoke-api.sh","fields":[{"key":"amount","label":"Số tiền","type":"number","required":true}]}' "$object_key")"

echo "smoke: POST /api/v1/business-objects (create)"
status="$(request POST /api/v1/business-objects "$object_body")"
[[ "$status" == "201" ]] || fail "creating a business object returned $status, expected 201"
grep -q "\"key\":\"$object_key\"" "$body_file" || fail "create response does not contain the created key"

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

echo "smoke: GET /api/v1/does-not-exist (unknown route -> 404 envelope)"
status="$(request GET /api/v1/does-not-exist)"
[[ "$status" == "404" ]] || fail "unknown route returned $status, expected 404"
grep -q '"code":"not_found"' "$body_file" || fail "unknown route did not return the not_found error code"

echo "smoke: PASS"
