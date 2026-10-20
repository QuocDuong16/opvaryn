#!/usr/bin/env bash
#
# Smoke test for the OPVARYN API: builds the server and the useradm CLI, starts the
# server, and exercises business objects, definition versioning, the process runtime
# and the identity surface against the local PostgreSQL.
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
tmp_records="$(mktemp -t opvaryn-smoke-records.XXXXXX)"
smoke_tmp_dir="$(mktemp -d -t opvaryn-smoke-session.XXXXXX)"
designer_jar="$smoke_tmp_dir/designer.cookies"
director_jar="$smoke_tmp_dir/director.cookies"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ -n "${receiver_pid:-}" ]] && kill -0 "$receiver_pid" 2>/dev/null; then
    kill "$receiver_pid" 2>/dev/null || true
    wait "$receiver_pid" 2>/dev/null || true
  fi
  rm -f "$log_file" "$body_file" "$tmp_records"
  rm -rf "$smoke_tmp_dir"
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

# request_as <cookie-jar> <method> <path> [json-body]: like request, but keeps cookies
request_as() {
  local jar="$1" method="$2" path="$3" json="${4:-}"
  if [[ -n "$json" ]]; then
    curl -sS -o "$body_file" -w '%{http_code}' -X "$method" "$base_url$path" \
      -b "$jar" -c "$jar" -H 'Content-Type: application/json' -d "$json"
  else
    curl -sS -o "$body_file" -w '%{http_code}' -X "$method" "$base_url$path" -b "$jar" -c "$jar"
  fi
}

# login_as <cookie-jar> <email> <password>: writes the response body to $body_file
login_as() {
  request_as "$1" POST /api/v1/auth/login \
    "$(printf '{"email":"%s","password":"%s"}' "$2" "$3")"
}

# Leftovers from earlier runs made the Data screen unreadable (118 objects after a day), so
# every run tidies up first. Only smoke-tagged rows are removed: make clean-smoke-data does the
# same thing by hand, and the pilot data never matches.
clean_log="$(mktemp -t opvaryn-clean.XXXXXX)"
if ! bash "$root_dir/scripts/clean-smoke-data.sh" >"$clean_log" 2>&1; then
  # Loud on purpose: a cleanup that fails silently is how the Data screen filled up.
  echo "smoke: could not clean leftovers from earlier runs — continuing anyway:" >&2
  tail -n 5 "$clean_log" >&2
fi
rm -f "$clean_log"

echo "smoke: building the API server"
(cd "$api_dir" && go build -o bin/server ./cmd/server)

if curl -sf "$base_url/healthz" >/dev/null 2>&1; then
  fail "another server is already answering on $base_url — stop it before running the smoke test"
fi

# A real receiver for the outbound webhook (ADR 0012). It refuses the first request on
# purpose, so the retry path is exercised rather than assumed.
receiver_file="$smoke_tmp_dir/webhook-received.jsonl"
receiver_port=21912
python3 "$root_dir/scripts/webhook-receiver.py" "$receiver_file" 1 "$receiver_port" &
receiver_pid=$!
for _ in $(seq 1 20); do
  if curl -s -o /dev/null "http://127.0.0.1:$receiver_port/" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

# The key that seals the two-step secret (ADR 0030) is generated for this run only:
# a committed literal would read as a hardcoded secret to the secret scanners, and a
# test key has no reason to be stable.
totp_key="$(head -c 32 /dev/urandom | base64)"

echo "smoke: starting the API (outbound webhook pointed at the receiver)"
OPVARYN_WEBHOOK_URL="http://127.0.0.1:$receiver_port/" \
  OPVARYN_WEBHOOK_SECRET="smoke-webhook-secret" \
  OPVARYN_WEBHOOK_MAX_ATTEMPTS=3 \
  TOTP_ENCRYPTION_KEY="$totp_key" \
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

echo "smoke: bootstrap departments and users (useradm CLI)"
stamp="$(date +%s)"
department_key="smoke_dept_$stamp"
designer_role="smoke_approver_$stamp"
director_role="smoke_director_$stamp"
designer_email="designer_$stamp@example.com"
director_email="director_$stamp@example.com"
smoke_password="smoke-test-password"

(cd "$api_dir" && go build -o bin/useradm ./cmd/useradm) || fail "building the useradm CLI failed"
useradm() { (cd "$api_dir" && ./bin/useradm "$@"); }

useradm -create-department -key "$department_key" -department-name "Smoke $stamp" >/dev/null ||
  fail "creating the smoke department failed"
other_department="smoke_other_$stamp"
outsider_role="smoke_outsider_$stamp"
outsider_email="outsider_$stamp@example.com"
admin_email="admin_$stamp@example.com"

useradm -create -email "$designer_email" -name "Smoke designer" -password "$smoke_password" \
  -department "$department_key" -roles "process_designer,$designer_role" >/dev/null ||
  fail "creating the designer failed"
useradm -create -email "$director_email" -name "Smoke director" -password "$smoke_password" \
  -department "$department_key" -roles "$director_role" >/dev/null || fail "creating the director failed"
useradm -create-department -key "$other_department" -department-name "Smoke other $stamp" >/dev/null ||
  fail "creating the second department failed"
useradm -create -email "$outsider_email" -name "Smoke outsider" -password "$smoke_password" \
  -department "$other_department" -roles "$outsider_role" >/dev/null || fail "creating the outsider failed"
useradm -create -email "$admin_email" -name "Smoke admin" -password "$smoke_password" \
  -department "$other_department" -roles "admin" >/dev/null || fail "creating the admin failed"
echo "smoke: users exist in $department_key and $other_department"

echo "smoke: POST /api/v1/auth/login (wrong password -> 401, then a real session)"
status="$(request POST /api/v1/auth/login "$(printf '{"email":"%s","password":"not-the-password"}' "$designer_email")")"
[[ "$status" == "401" ]] || fail "a wrong password returned $status, expected 401"
grep -q '"code":"unauthorized"' "$body_file" || fail "the login failure did not return the unauthorized code"
status="$(login_as "$designer_jar" "$designer_email" "$smoke_password")"
[[ "$status" == "200" ]] || fail "logging in returned $status, expected 200"
grep -q "$designer_email" "$body_file" || fail "the login response does not name the user"
grep -q 'opvaryn.session' "$designer_jar" || fail "the session cookie was not set"

echo "smoke: GET /api/v1/me (with and without a session)"
status="$(request_as "$designer_jar" GET /api/v1/me)"
[[ "$status" == "200" ]] || fail "/me with a session returned $status, expected 200"
grep -q "$designer_role" "$body_file" || fail "/me does not report the user's roles"
grep -q "$department_key" "$body_file" || fail "/me does not report the user's department"
status="$(request GET /api/v1/me)"
[[ "$status" == "401" ]] || fail "/me without a session returned $status, expected 401"
grep -q '"code":"unauthorized"' "$body_file" || fail "the anonymous /me did not return the unauthorized code"
status="$(request GET /api/v1/business-objects)"
[[ "$status" == "401" ]] || fail "reading definitions anonymously returned $status, expected 401"
grep -q '"code":"unauthorized"' "$body_file" || fail "the anonymous read did not return the unauthorized code"

for extra in director outsider admin; do
  status="$(login_as "$smoke_tmp_dir/$extra.cookies" "${extra}_$stamp@example.com" "$smoke_password")"
  [[ "$status" == "200" ]] || fail "signing in as the $extra returned $status"
done
director_jar="$smoke_tmp_dir/director.cookies"
outsider_jar="$smoke_tmp_dir/outsider.cookies"
admin_jar="$smoke_tmp_dir/admin.cookies"

echo "smoke: POST /api/v1/me/password (verify current, keep this session, end the others)"
outsider_second_jar="$smoke_tmp_dir/outsider-second.cookies"
status="$(login_as "$outsider_second_jar" "$outsider_email" "$smoke_password")"
[[ "$status" == "200" ]] || fail "the second outsider session could not sign in (status $status)"
status="$(request_as "$outsider_jar" POST /api/v1/me/password \
  '{"currentPassword":"not-the-password","newPassword":"another-smoke-password"}')"
[[ "$status" == "400" ]] || fail "a wrong current password returned $status, expected 400"
status="$(request_as "$outsider_jar" POST /api/v1/me/password \
  "$(printf '{"currentPassword":"%s","newPassword":"%s"}' "$smoke_password" "another-smoke-password")")"
[[ "$status" == "204" ]] || fail "changing the password returned $status, expected 204"
status="$(request_as "$outsider_jar" GET /api/v1/me)"
[[ "$status" == "200" ]] || fail "changing the password signed the current session out (status $status)"
status="$(request_as "$outsider_second_jar" GET /api/v1/me)"
[[ "$status" == "401" ]] || fail "the other session survived a password change (status $status)"
status="$(request_as "$outsider_jar" POST /api/v1/me/password \
  "$(printf '{"currentPassword":"%s","newPassword":"%s"}' "another-smoke-password" "$smoke_password")")"
[[ "$status" == "204" ]] || fail "restoring the smoke password returned $status, expected 204"

echo "smoke: POST /api/v1/business-objects (create)"
status="$(request_as "$designer_jar" POST /api/v1/business-objects "$object_body")"
[[ "$status" == "201" ]] || fail "creating a business object returned $status, expected 201"
grep -q "\"key\":\"$object_key\"" "$body_file" || fail "create response does not contain the created key"
grep -q '"value":"urgent"' "$body_file" || fail "create response dropped the select options"

echo "smoke: POST /api/v1/business-objects (duplicate -> 409)"
status="$(request_as "$designer_jar" POST /api/v1/business-objects "$object_body")"
[[ "$status" == "409" ]] || fail "duplicate key returned $status, expected 409"
grep -q '"code":"conflict"' "$body_file" || fail "duplicate create did not return the conflict error code"

echo "smoke: POST /api/v1/business-objects (invalid input -> 400)"
status="$(request_as "$designer_jar" POST /api/v1/business-objects '{"key":"Not A Key","name":""}')"
[[ "$status" == "400" ]] || fail "invalid input returned $status, expected 400"
grep -q '"code":"invalid_request"' "$body_file" || fail "invalid create did not return the invalid_request error code"

echo "smoke: GET /api/v1/business-objects (list contains the created object)"
[[ "$(request_as "$designer_jar" GET /api/v1/business-objects)" == "200" ]] || fail "listing business objects did not return 200"
grep -q "\"key\":\"$object_key\"" "$body_file" || fail "the created object is missing from the list"

echo "smoke: GET /api/v1/business-objects/{key} (known and unknown keys)"
[[ "$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key")" == "200" ]] || fail "reading a business object did not return 200"
grep -q "\"key\":\"$object_key\"" "$body_file" || fail "the read object does not match the requested key"
status="$(request_as "$designer_jar" GET /api/v1/business-objects/smoke_missing_key)"
[[ "$status" == "404" ]] || fail "reading an unknown object returned $status, expected 404"
grep -q '"code":"not_found"' "$body_file" || fail "unknown object did not return the not_found error code"

echo "smoke: POST /api/v1/business-objects/{key}/records (create)"
status="$(request_as "$designer_jar" POST "/api/v1/business-objects/$object_key/records" '{"values":{"amount":1500000,"priority":"urgent"}}')"
[[ "$status" == "201" ]] || fail "creating a record returned $status, expected 201"
grep -q '"objectKey"' "$body_file" || fail "record response does not report its object key"

echo "smoke: POST records (unknown field key -> 400)"
status="$(request_as "$designer_jar" POST "/api/v1/business-objects/$object_key/records" '{"values":{"amount":1,"note":"not declared"}}')"
[[ "$status" == "400" ]] || fail "record with an undeclared field returned $status, expected 400"
grep -q 'field is not defined on this object' "$body_file" || fail "undeclared field was not reported as such"

echo "smoke: POST records (missing required -> 400)"
status="$(request_as "$designer_jar" POST "/api/v1/business-objects/$object_key/records" '{"values":{"priority":"normal"}}')"
[[ "$status" == "400" ]] || fail "record without the required field returned $status, expected 400"
grep -q '"code":"invalid_request"' "$body_file" || fail "invalid record did not return the invalid_request error code"

echo "smoke: POST records (value outside the declared options -> 400)"
status="$(request_as "$designer_jar" POST "/api/v1/business-objects/$object_key/records" '{"values":{"amount":10,"priority":"later"}}')"
[[ "$status" == "400" ]] || fail "record with an undeclared option returned $status, expected 400"
grep -q 'not one of the declared options' "$body_file" || fail "undeclared option was not reported as such"

echo "smoke: POST records (unknown object -> 404)"
status="$(request_as "$designer_jar" POST /api/v1/business-objects/smoke_missing_key/records '{"values":{}}')"
[[ "$status" == "404" ]] || fail "record for an unknown object returned $status, expected 404"

echo "smoke: GET /api/v1/business-objects/{key}/records (list contains the created record)"
[[ "$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records")" == "200" ]] || fail "listing records did not return 200"
grep -q '"amount":1500000' "$body_file" || fail "the created record is missing from the list"
grep -q '"objectVersion":1' "$body_file" || fail "a record created before any edit should be bound to version 1"

echo "smoke: PUT /api/v1/business-objects/{key} (publishes version 2)"
update_body="$(printf '{"name":"Smoke test object (v2)","description":"published by scripts/smoke-api.sh","fields":[{"key":"amount","label":"Số tiền (VND)","type":"number","required":true},{"key":"note","label":"Ghi chú","type":"text"}]}')"
status="$(request_as "$designer_jar" PUT "/api/v1/business-objects/$object_key" "$update_body")"
[[ "$status" == "200" ]] || fail "updating a business object returned $status, expected 200"
grep -q '"version":2' "$body_file" || fail "the update did not publish version 2"
grep -q '"key":"note"' "$body_file" || fail "the new version does not carry the new schema"

echo "smoke: PUT (invalid definition -> 400, unknown key -> 404)"
status="$(request_as "$designer_jar" PUT "/api/v1/business-objects/$object_key" '{"name":"","fields":[{"key":"bad key","label":"x","type":"text"}]}')"
[[ "$status" == "400" ]] || fail "invalid definition update returned $status, expected 400"
grep -q '"code":"invalid_request"' "$body_file" || fail "invalid update did not return the invalid_request error code"
status="$(request_as "$designer_jar" PUT /api/v1/business-objects/smoke_missing_key '{"name":"Không tồn tại"}')"
[[ "$status" == "404" ]] || fail "updating an unknown object returned $status, expected 404"
grep -q '"code":"not_found"' "$body_file" || fail "unknown object update did not return the not_found error code"

echo "smoke: POST records (after the edit -> binds to version 2)"
status="$(request_as "$designer_jar" POST "/api/v1/business-objects/$object_key/records" '{"values":{"amount":5000,"note":"ghi chú v2"}}')"
[[ "$status" == "201" ]] || fail "creating a record after the update returned $status, expected 201"
grep -q '"objectVersion":2' "$body_file" || fail "a new record should bind to the newest version"

echo "smoke: GET /api/v1/business-objects/{key}/versions (newest first, history intact)"
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/versions")"
[[ "$status" == "200" ]] || fail "listing definition versions returned $status, expected 200"
python3 - "$body_file" <<'PY' || fail "definition versions are not correctly ordered or incomplete"
import json, sys

versions = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
numbers = [version["version"] for version in versions]
if numbers != sorted(numbers, reverse=True) or numbers != [2, 1]:
    sys.exit(f"expected versions [2, 1], got {numbers}")
if any(version["publishedBy"] != "Smoke designer" for version in versions):
    sys.exit("publishing must be attributed to the signed-in designer")
newest = [field["key"] for field in versions[0]["fields"]]
oldest = [field["key"] for field in versions[-1]["fields"]]
if newest != ["amount", "note"] or oldest != ["amount", "priority"]:
    sys.exit(f"version schemas are wrong: newest {newest}, oldest {oldest}")
print("smoke: version history verified")
PY

echo "smoke: the record search looks at values, not at field names"
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records?q=ghi%20ch%C3%BA%20v2")"
[[ "$status" == "200" ]] || fail "searching the records returned $status, expected 200"
python3 - "$body_file" <<'PY' || fail "the record search did not find the record by its value"
import json, sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
if len(records) != 1 or records[0]["values"].get("note") != "ghi chú v2":
    sys.exit(f"expected the one record whose value matches, got {records}")
PY

# A number is a value too: the search reaches the typed projection.
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records?q=1500000")"
[[ "$status" == "200" ]] || fail "searching for a number returned $status, expected 200"
python3 - "$body_file" <<'PY' || fail "the record search did not find the record by its number"
import json, sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
if len(records) != 1 or records[0]["values"].get("amount") != 1500000:
    sys.exit(f"expected the one record whose number matches, got {records}")
PY

# A wildcard in the search term is literal: "%" must not match every record.
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records?q=%25")"
[[ "$status" == "200" ]] || fail "searching for a percent sign returned $status, expected 200"
python3 - "$body_file" <<'PY' || fail "the search treated the percent sign as a wildcard"
import json, sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
if records:
    sys.exit(f"a percent sign must be literal, got {len(records)} record(s)")
PY

# A field name is not a value: searching for it must find nothing.
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records?q=amount")"
[[ "$status" == "200" ]] || fail "searching for a field name returned $status, expected 200"
python3 - "$body_file" <<'PY' || fail "the record search matched a field name"
import json, sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
if records:
    sys.exit(f"a field name must not match a value, got {len(records)} record(s)")
PY

echo "smoke: records keep the definition version they were created under"
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records")"
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

echo "smoke: one record can be read, edited and deleted (ADR 0023)"
curl -sS -b "$designer_jar" -o "$tmp_records" "$base_url/api/v1/business-objects/$object_key/records"
v1_record="$(python3 -c 'import json,sys; print(next(r["id"] for r in json.load(open(sys.argv[1]))["data"] if r["objectVersion"]==1))' "$tmp_records")"
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records/$v1_record")"
[[ "$status" == "200" ]] || fail "reading one record returned $status, expected 200"
grep -q '"canEdit":true' "$body_file" || fail "the creator must be offered the edit controls"
grep -q '"objectVersion":1' "$body_file" || fail "the record no longer reports its own version"
status="$(request_as "$outsider_jar" GET "/api/v1/business-objects/$object_key/records/$v1_record")"
[[ "$status" == "404" ]] || fail "a record outside the caller's scope returned $status, expected 404"

# The record belongs to version 1 (amount, priority); a field that only exists in version 2
# must be refused, because a record is validated with the schema it was created under.
status="$(request_as "$designer_jar" PUT "/api/v1/business-objects/$object_key/records/$v1_record" \
  '{"values":{"amount":1500000,"note":"not in version 1"}}')"
[[ "$status" == "400" ]] || fail "editing a v1 record with a v2 field returned $status, expected 400"
grep -q 'field is not defined on this object' "$body_file" || fail "the v2-only field was not reported"

status="$(request_as "$designer_jar" PUT "/api/v1/business-objects/$object_key/records/$v1_record" \
  '{"values":{"amount":1500000,"priority":"normal"}}')"
[[ "$status" == "200" ]] || fail "editing a record returned $status, expected 200"
grep -q '"priority":"normal"' "$body_file" || fail "the edited value is missing from the response"
grep -q '"objectVersion":1' "$body_file" || fail "editing must keep the record's definition version"

status="$(request_as "$outsider_jar" PUT "/api/v1/business-objects/$object_key/records/$v1_record" \
  '{"values":{"amount":1500000,"priority":"normal"}}')"
[[ "$status" == "404" ]] || fail "editing a record outside the caller's scope returned $status, expected 404"

echo "smoke: record history (created, field change, labels, scope)"
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records/$v1_record/history")"
[[ "$status" == "200" ]] || fail "reading the record history returned $status, expected 200"
grep -q '"action":"created"' "$body_file" || fail "the creation is missing from the history"
grep -q '"action":"updated"' "$body_file" || fail "the edit is missing from the history"
grep -q '"fieldLabel":"Mức ưu tiên"' "$body_file" ||
  fail "the history must show the field label, not the key"
grep -q '"from":"Gấp"' "$body_file" || fail "the old select value is missing"
grep -q '"to":"Bình thường"' "$body_file" || fail "the new select value is missing"
status="$(request_as "$outsider_jar" GET "/api/v1/business-objects/$object_key/records/$v1_record/history")"
[[ "$status" == "404" ]] || fail "a hidden record's history returned $status, expected 404"

echo "smoke: deleting an unused record, and refusing a malformed id"
status="$(request_as "$designer_jar" POST "/api/v1/business-objects/$object_key/records" \
  '{"values":{"amount":123,"note":"Bản ghi tạm"}}')"
[[ "$status" == "201" ]] || fail "creating the throwaway record returned $status"
throwaway_record="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$body_file")"
status="$(request_as "$designer_jar" DELETE "/api/v1/business-objects/$object_key/records/$throwaway_record")"
[[ "$status" == "204" ]] || fail "deleting an unused record returned $status, expected 204"
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records/$throwaway_record")"
[[ "$status" == "404" ]] || fail "a deleted record still answers $status, expected 404"
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records/not-a-uuid")"
[[ "$status" == "400" ]] || fail "a malformed record id returned $status, expected 400"

echo "smoke: GET records export (CSV, scope, search and old-version columns)"
export_file="$smoke_tmp_dir/records.csv"
export_headers="$smoke_tmp_dir/records.headers"
status="$(curl -sS -b "$designer_jar" -D "$export_headers" -o "$export_file" -w '%{http_code}' \
  "$base_url/api/v1/business-objects/$object_key/records/export")"
[[ "$status" == "200" ]] || fail "exporting records returned $status, expected 200"
grep -qi '^content-type: text/csv' "$export_headers" || fail "the export is not served as CSV"
grep -qi '^content-disposition: attachment; filename=' "$export_headers" ||
  fail "the export is not offered as a download"
python3 - "$export_file" <<'PY' || fail "the exported CSV does not match the records"
import csv, io, sys

raw = open(sys.argv[1], "rb").read()
if not raw.startswith(b"\xef\xbb\xbf"):
    sys.exit("the CSV is missing the UTF-8 BOM Excel needs")
rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
if rows[0] != ["Số tiền (VND)", "Ghi chú", "Mức ưu tiên"]:
    sys.exit(f"the header lost a version's field or its label: {rows[0]}")
records = {row[0]: row for row in rows[1:]}
if len(records) != 2:
    sys.exit(f"expected 2 visible records, got {len(records)}")
v1 = records.get("1500000")
if v1 is None or v1[1] != "" or v1[2] != "Bình thường":
    sys.exit(f"the version 1 record lost its select value: {v1}")
v2 = records.get("5000")
if v2 is None or v2[1] != "ghi chú v2" or v2[2] != "":
    sys.exit(f"the version 2 record is wrong: {v2}")
print("smoke: the export carries both versions and the select label")
PY

status="$(curl -sS -b "$outsider_jar" -o "$smoke_tmp_dir/outsider.csv" -w '%{http_code}' \
  "$base_url/api/v1/business-objects/$object_key/records/export")"
[[ "$status" == "200" ]] || fail "exporting as another department returned $status, expected 200"
python3 - "$smoke_tmp_dir/outsider.csv" <<'PY' || fail "the export ignored the department scope"
import csv, io, sys

rows = list(csv.reader(io.StringIO(open(sys.argv[1], encoding="utf-8-sig").read())))
if len(rows) != 1:
    sys.exit(f"another department must get an empty export, got {len(rows) - 1} row(s)")
print("smoke: the export follows the record scope")
PY

status="$(curl -sS -b "$designer_jar" -o "$smoke_tmp_dir/search.csv" -w '%{http_code}' \
  "$base_url/api/v1/business-objects/$object_key/records/export?q=ghi%20ch%C3%BA%20v2")"
[[ "$status" == "200" ]] || fail "exporting with a search returned $status, expected 200"
python3 - "$smoke_tmp_dir/search.csv" <<'PY' || fail "the export ignored the search term"
import csv, io, sys

rows = list(csv.reader(io.StringIO(open(sys.argv[1], encoding="utf-8-sig").read())))
if len(rows) != 2 or rows[1][1] != "ghi chú v2":
    sys.exit(f"the search should keep exactly the version 2 record: {rows}")
print("smoke: the export applies the search")
PY

echo "smoke: attachments (upload, bind, download, scope, replace, delete)"
files_key="smoke_files_$stamp"
files_body="$(printf '{"key":"%s","name":"Smoke files %s","fields":[{"key":"title","label":"Nội dung","type":"text","required":true},{"key":"quote","label":"Báo giá","type":"file"}]}' "$files_key" "$stamp")"
status="$(request_as "$designer_jar" POST /api/v1/business-objects "$files_body")"
[[ "$status" == "201" ]] || fail "creating the attachments object returned $status, expected 201"

printf 'báo giá: 1.500.000\n' > "$smoke_tmp_dir/quote.txt"
status="$(curl -sS -b "$designer_jar" -o "$smoke_tmp_dir/attachment.json" -w '%{http_code}' -X POST \
  "$base_url/api/v1/attachments?objectKey=$files_key" \
  -F "file=@$smoke_tmp_dir/quote.txt;filename=báo giá.txt")"
[[ "$status" == "201" ]] || fail "uploading an attachment returned $status, expected 201"
grep -q 'báo giá.txt' "$smoke_tmp_dir/attachment.json" || fail "the upload lost the file name"
attachment_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$smoke_tmp_dir/attachment.json")"

status="$(request_as "$designer_jar" POST "/api/v1/business-objects/$files_key/records" \
  "$(printf '{"values":{"title":"Có tệp","quote":"%s"}}' "$attachment_id")")"
[[ "$status" == "201" ]] || fail "creating a record with a file returned $status, expected 201"
files_record="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$body_file")"

status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$files_key/records/$files_record")"
[[ "$status" == "200" ]] || fail "reading the record with a file returned $status"
grep -q 'báo giá.txt' "$body_file" || fail "the record does not name its attachment"

status="$(curl -sS -b "$designer_jar" -D "$smoke_tmp_dir/download.headers" -o "$smoke_tmp_dir/download.txt" \
  -w '%{http_code}' "$base_url/api/v1/attachments/$attachment_id")"
[[ "$status" == "200" ]] || fail "downloading the attachment returned $status, expected 200"
grep -qi '^content-type: application/octet-stream' "$smoke_tmp_dir/download.headers" ||
  fail "a download must not be served with a renderable content type"
grep -qi '^content-disposition: attachment;' "$smoke_tmp_dir/download.headers" ||
  fail "the download is missing Content-Disposition"
grep -q '1.500.000' "$smoke_tmp_dir/download.txt" || fail "the downloaded bytes are wrong"

status="$(request_as "$outsider_jar" GET "/api/v1/attachments/$attachment_id")"
[[ "$status" == "404" ]] || fail "an attachment outside the caller's scope returned $status, expected 404"
status="$(request_as "$designer_jar" DELETE "/api/v1/attachments/$attachment_id")"
[[ "$status" == "409" ]] || fail "deleting a bound file returned $status, expected 409"

status="$(request_as "$designer_jar" PUT "/api/v1/business-objects/$files_key/records/$files_record" \
  '{"values":{"title":"Bỏ tệp"}}')"
[[ "$status" == "200" ]] || fail "removing the file from the record returned $status, expected 200"
status="$(request_as "$designer_jar" GET "/api/v1/attachments/$attachment_id")"
[[ "$status" == "404" ]] || fail "the replaced file still exists (status $status)"

status="$(curl -sS -b "$designer_jar" -o "$smoke_tmp_dir/attachment2.json" -w '%{http_code}' -X POST \
  "$base_url/api/v1/attachments?objectKey=$files_key" \
  -F "file=@$smoke_tmp_dir/quote.txt;filename=nháp.txt")"
[[ "$status" == "201" ]] || fail "uploading a second attachment returned $status"
second_attachment="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$smoke_tmp_dir/attachment2.json")"
status="$(request_as "$designer_jar" DELETE "/api/v1/attachments/$second_attachment")"
[[ "$status" == "204" ]] || fail "deleting an unbound upload returned $status, expected 204"

echo "smoke: CSV import (dry run, parsing, all-or-nothing, row errors)"
import_file="$smoke_tmp_dir/import.csv"
printf 'Nội dung\nĐề nghị nhập 1\nĐề nghị nhập 2\n' > "$import_file"
status="$(curl -sS -b "$designer_jar" -o "$smoke_tmp_dir/import-dry.json" -w '%{http_code}' \
  -X POST "$base_url/api/v1/business-objects/$files_key/records/import?dryRun=true" \
  -F "file=@$import_file;type=text/csv")"
[[ "$status" == "200" ]] || fail "a dry-run import returned $status, expected 200"
python3 - "$smoke_tmp_dir/import-dry.json" <<'PY' || fail "the dry run did not report two valid rows"
import json, sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
if not result["dryRun"] or result["rows"] != 2 or result["valid"] != 2 or result["created"] != 0:
    sys.exit(f"unexpected dry-run result: {result}")
if result["errors"]:
    sys.exit(f"unexpected dry-run errors: {result['errors']}")
print("smoke: the dry run validated two rows without writing")
PY
curl -sS -b "$designer_jar" -o "$smoke_tmp_dir/files-before.json" \
  "$base_url/api/v1/business-objects/$files_key/records"
python3 - "$smoke_tmp_dir/files-before.json" <<'PY' || fail "a dry run wrote a record"
import json, sys

total = json.load(open(sys.argv[1], encoding="utf-8"))["total"]
if total != 1:
    sys.exit(f"a dry run wrote records: {total}")
print("smoke: the dry run wrote nothing")
PY

printf 'Nội dung,Báo giá\n,\n' > "$smoke_tmp_dir/import-bad.csv"
status="$(curl -sS -b "$designer_jar" -o "$smoke_tmp_dir/import-bad.json" -w '%{http_code}' \
  -X POST "$base_url/api/v1/business-objects/$files_key/records/import" \
  -F "file=@$smoke_tmp_dir/import-bad.csv;type=text/csv")"
[[ "$status" == "200" ]] || fail "a file with a bad row returned $status, expected 200 with errors"
python3 - "$smoke_tmp_dir/import-bad.json" <<'PY' || fail "the bad row was not reported"
import json, sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
if result["created"] != 0 or len(result["errors"]) == 0:
    sys.exit(f"a bad row must create nothing and be reported: {result}")
if result["errors"][0]["row"] != 2:
    sys.exit(f"the first data row is line 2, got {result['errors'][0]['row']}")
print("smoke: a bad row is reported by line and nothing is written")
PY

status="$(curl -sS -b "$designer_jar" -o "$smoke_tmp_dir/import.json" -w '%{http_code}' \
  -X POST "$base_url/api/v1/business-objects/$files_key/records/import" \
  -F "file=@$import_file;type=text/csv")"
[[ "$status" == "200" ]] || fail "importing returned $status, expected 200"
grep -q '"created":2' "$smoke_tmp_dir/import.json" || fail "two rows were not created"
curl -sS -b "$designer_jar" -o "$smoke_tmp_dir/files-after.json" \
  "$base_url/api/v1/business-objects/$files_key/records"
python3 - "$smoke_tmp_dir/files-after.json" <<'PY' || fail "the imported records are missing"
import json, sys

page = json.load(open(sys.argv[1], encoding="utf-8"))
titles = {record["values"].get("title") for record in page["data"]}
if page["total"] != 3 or "Đề nghị nhập 1" not in titles or "Đề nghị nhập 2" not in titles:
    sys.exit(f"unexpected records after import: {page['total']} {titles}")
print("smoke: the imported rows are stored")
PY

# A dry run on the main object checks the Vietnamese number/date/select conversions without
# touching the records the metric tests below count.
printf 'Số tiền (VND),Ghi chú\n"1.500.000",Nhập từ CSV\n12,5,"Có dấu phẩy"\n' > "$smoke_tmp_dir/import-vn.csv"
status="$(curl -sS -b "$designer_jar" -o "$smoke_tmp_dir/import-vn.json" -w '%{http_code}' \
  -X POST "$base_url/api/v1/business-objects/$object_key/records/import?dryRun=true" \
  -F "file=@$smoke_tmp_dir/import-vn.csv;type=text/csv")"
[[ "$status" == "200" ]] || fail "the Vietnamese-format dry run returned $status"
grep -q '"valid":2' "$smoke_tmp_dir/import-vn.json" ||
  fail "the Vietnamese number/decimal rows were not accepted"

printf 'Không có cột này\n1\n' > "$smoke_tmp_dir/import-header.csv"
status="$(curl -sS -b "$designer_jar" -o "$smoke_tmp_dir/import-header.json" -w '%{http_code}' \
  -X POST "$base_url/api/v1/business-objects/$files_key/records/import" \
  -F "file=@$smoke_tmp_dir/import-header.csv;type=text/csv")"
[[ "$status" == "400" ]] || fail "an unknown header returned $status, expected 400"
grep -q '"code":"invalid_request"' "$smoke_tmp_dir/import-header.json" ||
  fail "the header error did not use the invalid_request code"

echo "smoke: POST /api/v1/process-definitions (create + publish v1)"
process_key="smoke_flow_$stamp"
process_body="$(printf '{"key":"%s","name":"Smoke approval flow","description":"created by scripts/smoke-api.sh","objectKey":"%s","nodes":[{"key":"start","type":"start","title":"Nhận đề nghị"},{"key":"approve","type":"human_task","title":"Trưởng bộ phận duyệt","assigneeRole":"%s"},{"key":"gate","type":"condition","title":"Trên 1 triệu?","condition":{"field":"amount","op":"gte","value":1000000}},{"key":"escalate","type":"human_task","title":"Giám đốc duyệt","assigneeRole":"%s"},{"key":"end","type":"end","title":"Kết thúc"}],"edges":[{"from":"start","to":"approve"},{"from":"approve","to":"gate"},{"from":"gate","to":"escalate","when":"true"},{"from":"gate","to":"end","when":"false"},{"from":"escalate","to":"end"}]}' "$process_key" "$object_key" "$designer_role" "$director_role")"
status="$(request_as "$designer_jar" POST /api/v1/process-definitions "$process_body")"
[[ "$status" == "201" ]] || fail "creating a process definition returned $status, expected 201"
grep -q "$process_key" "$body_file" || fail "the created process definition is missing from the response"
grep -q '"version":1' "$body_file" || fail "creating a process definition must publish version 1"

echo "smoke: POST /api/v1/process-definitions (invalid graph -> 400)"
status="$(request_as "$designer_jar" POST /api/v1/process-definitions "$(printf '{"key":"smoke_bad_flow_%s","name":"Graph sai","objectKey":"%s","nodes":[{"key":"start","type":"start","title":"S"},{"key":"end","type":"end","title":"E"}],"edges":[{"from":"start","to":"end"}]}' "$stamp" "$object_key")")"
[[ "$status" == "400" ]] || fail "a graph without a human task returned $status, expected 400"
grep -q 'at least one human_task' "$body_file" || fail "the missing human task was not reported"

# The records created above: v1 carries amount 1500000 (above the threshold),
# v2 carries amount 5000 (below it), so both branches can be exercised.
curl -sS -b "$designer_jar" -o "$tmp_records" "$base_url/api/v1/business-objects/$object_key/records"
above_record="$(python3 -c 'import json,sys; print(next(r["id"] for r in json.load(open(sys.argv[1]))["data"] if r["values"].get("amount")==1500000))' "$tmp_records")"
below_record="$(python3 -c 'import json,sys; print(next(r["id"] for r in json.load(open(sys.argv[1]))["data"] if r["values"].get("amount")==5000))' "$tmp_records")"

echo "smoke: starting an instance without a session -> 401"
status="$(request POST /api/v1/process-instances "$(printf '{"definitionKey":"%s","recordId":"%s"}' "$process_key" "$above_record")")"
[[ "$status" == "401" ]] || fail "an anonymous start returned $status, expected 401"
grep -q '"code":"unauthorized"' "$body_file" || fail "the anonymous start did not return the unauthorized code"

echo "smoke: POST /api/v1/process-instances (with a session, above the threshold)"
status="$(request_as "$designer_jar" POST /api/v1/process-instances "$(printf '{"definitionKey":"%s","recordId":"%s"}' "$process_key" "$above_record")")"
[[ "$status" == "201" ]] || fail "starting a process instance returned $status, expected 201"
grep -q '"state":"running"' "$body_file" || fail "a fresh instance must be running"
grep -q '"currentNode":"approve"' "$body_file" || fail "the instance should wait at the first human task"
grep -q '"type":"instance_started"' "$body_file" || fail "the audit log must record the start"
grep -q "$designer_email" "$body_file" || fail "the start must be attributed to the signed-in user"
instance_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["instance"]["id"])' "$body_file")"
approver_task="$(python3 -c 'import json,sys; print(next(t["id"] for t in json.load(open(sys.argv[1]))["tasks"] if t["nodeKey"]=="approve"))' "$body_file")"

echo "smoke: return without a reason -> 400"
status="$(request_as "$designer_jar" POST "/api/v1/process-instances/$instance_id/tasks/$approver_task/decisions" '{"decision":"return"}')"
[[ "$status" == "400" ]] || fail "a return without a reason returned $status, expected 400"
grep -q 'must carry a reason' "$body_file" || fail "the missing reason was not reported"

echo "smoke: approve -> the condition routes above the threshold"
status="$(request_as "$designer_jar" POST "/api/v1/process-instances/$instance_id/tasks/$approver_task/decisions" '{"decision":"approve"}')"
[[ "$status" == "200" ]] || fail "approving the first task returned $status, expected 200"
grep -q '"currentNode":"escalate"' "$body_file" || fail "a value above the threshold must wait for the director"
grep -q '"type":"condition_evaluated"' "$body_file" || fail "the condition evaluation must be in the audit log"
grep -q '"result":true' "$body_file" || fail "the condition should have evaluated true"
director_task="$(python3 -c 'import json,sys; print(next(t["id"] for t in json.load(open(sys.argv[1]))["tasks"] if t["nodeKey"]=="escalate"))' "$body_file")"

echo "smoke: deciding a task the user does not hold -> 403"
status="$(request_as "$designer_jar" POST "/api/v1/process-instances/$instance_id/tasks/$director_task/decisions" '{"decision":"approve"}')"
[[ "$status" == "403" ]] || fail "deciding a task held by another role returned $status, expected 403"
grep -q '"code":"forbidden"' "$body_file" || fail "the role check did not return the forbidden error code"

echo "smoke: the director signs in and approves -> completed"
status="$(login_as "$director_jar" "$director_email" "$smoke_password")"
[[ "$status" == "200" ]] || fail "the director could not sign in (status $status)"
status="$(request_as "$director_jar" POST "/api/v1/process-instances/$instance_id/tasks/$director_task/decisions" '{"decision":"approve"}')"
[[ "$status" == "200" ]] || fail "approving the director task returned $status, expected 200"
grep -q '"state":"completed"' "$body_file" || fail "the instance should be completed"
grep -q '"finishedAt"' "$body_file" || fail "a completed instance must carry finishedAt"
grep -q '"type":"instance_completed"' "$body_file" || fail "the audit log must record the completion"

echo "smoke: deciding an already decided task -> 409"
status="$(request_as "$director_jar" POST "/api/v1/process-instances/$instance_id/tasks/$director_task/decisions" '{"decision":"approve"}')"
[[ "$status" == "409" ]] || fail "deciding a closed task returned $status, expected 409"
grep -q '"code":"conflict"' "$body_file" || fail "the second decision did not return the conflict error code"

echo "smoke: start below the threshold -> one approval completes it"
status="$(request_as "$designer_jar" POST /api/v1/process-instances "$(printf '{"definitionKey":"%s","recordId":"%s"}' "$process_key" "$below_record")")"
[[ "$status" == "201" ]] || fail "starting the second instance returned $status, expected 201"
second_instance="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["instance"]["id"])' "$body_file")"
second_task="$(python3 -c 'import json,sys; print(next(t["id"] for t in json.load(open(sys.argv[1]))["tasks"] if t["nodeKey"]=="approve"))' "$body_file")"
status="$(request_as "$designer_jar" POST "/api/v1/process-instances/$second_instance/tasks/$second_task/decisions" '{"decision":"approve"}')"
[[ "$status" == "200" ]] || fail "approving the second instance returned $status, expected 200"
grep -q '"result":false' "$body_file" || fail "the condition should have evaluated false below the threshold"
grep -q '"state":"completed"' "$body_file" || fail "the below-threshold instance should complete after one approval"

echo "smoke: return resets the instance to a new attempt"
status="$(request_as "$designer_jar" POST /api/v1/process-instances "$(printf '{"definitionKey":"%s","recordId":"%s"}' "$process_key" "$above_record")")"
[[ "$status" == "201" ]] || fail "starting the third instance returned $status, expected 201"
third_instance="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["instance"]["id"])' "$body_file")"
third_task="$(python3 -c 'import json,sys; print(next(t["id"] for t in json.load(open(sys.argv[1]))["tasks"] if t["nodeKey"]=="approve"))' "$body_file")"
status="$(request_as "$designer_jar" POST "/api/v1/process-instances/$third_instance/tasks/$third_task/decisions" '{"decision":"return","reason":"Bổ sung báo giá"}')"
[[ "$status" == "200" ]] || fail "returning the task returned $status, expected 200"
grep -q '"attempt":2' "$body_file" || fail "a return must start attempt 2"
grep -q '"state":"running"' "$body_file" || fail "a returned instance keeps running"
grep -q 'Bổ sung báo giá' "$body_file" || fail "the return reason must be recorded"
python3 - "$body_file" <<'CHECK'
import json, sys

view = json.load(open(sys.argv[1], encoding="utf-8"))
tasks = view["tasks"]
returned = [task for task in tasks if task["status"] == "returned" and task["attempt"] == 1]
reopened = [task for task in tasks if task["status"] == "open" and task["attempt"] == 2]
if len(returned) != 1 or len(reopened) != 1:
    sys.exit(f"expected one returned task on attempt 1 and one open task on attempt 2, got {tasks}")
print("smoke: the reset recreated the first task on attempt 2")
CHECK

echo "smoke: reject is terminal"
status="$(request_as "$designer_jar" POST /api/v1/process-instances "$(printf '{"definitionKey":"%s","recordId":"%s"}' "$process_key" "$above_record")")"
[[ "$status" == "201" ]] || fail "starting the fourth instance returned $status, expected 201"
fourth_instance="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["instance"]["id"])' "$body_file")"
fourth_task="$(python3 -c 'import json,sys; print(next(t["id"] for t in json.load(open(sys.argv[1]))["tasks"] if t["nodeKey"]=="approve"))' "$body_file")"
status="$(request_as "$designer_jar" POST "/api/v1/process-instances/$fourth_instance/tasks/$fourth_task/decisions" '{"decision":"reject","reason":"Ngoài ngân sách"}')"
[[ "$status" == "200" ]] || fail "rejecting the task returned $status, expected 200"
grep -q '"state":"rejected"' "$body_file" || fail "a rejected instance must be terminal"
grep -q '"type":"instance_rejected"' "$body_file" || fail "the audit log must record the rejection"

echo "smoke: GET /api/v1/process-instances/{id} (session required, log survives a re-read)"
status="$(request GET "/api/v1/process-instances/$instance_id")"
[[ "$status" == "401" ]] || fail "reading an instance without a session returned $status, expected 401"
status="$(request_as "$director_jar" GET "/api/v1/process-instances/$instance_id")"
[[ "$status" == "200" ]] || fail "reading the instance returned $status, expected 200"
grep -q '"type":"task_approved"' "$body_file" || fail "the re-read log lost the approval event"

echo "smoke: another department cannot read the instance -> 404"
status="$(request_as "$outsider_jar" GET "/api/v1/process-instances/$instance_id")"
[[ "$status" == "404" ]] || fail "reading an instance from another department returned $status, expected 404"

echo "smoke: a record with a process instance cannot be deleted -> 409 in_use"
status="$(request_as "$designer_jar" DELETE "/api/v1/business-objects/$object_key/records/$above_record")"
[[ "$status" == "409" ]] || fail "deleting a record with an instance returned $status, expected 409"
grep -q '"code":"in_use"' "$body_file" || fail "the record guard did not return the in_use code"
status="$(request_as "$designer_jar" GET "/api/v1/business-objects/$object_key/records/$above_record")"
[[ "$status" == "200" ]] || fail "the refused delete removed the record (status $status)"

echo "smoke: the inbox lists the signed-in user's own open task"
status="$(request_as "$designer_jar" GET /api/v1/tasks)"
[[ "$status" == "200" ]] || fail "reading the inbox returned $status, expected 200"
grep -q "$process_key" "$body_file" || fail "the designer's inbox lost the open task"
status="$(request_as "$outsider_jar" GET /api/v1/tasks)"
[[ "$status" == "200" ]] || fail "reading the outsider inbox returned $status"
grep -q '"data":\[\]' "$body_file" || fail "a user without the role must have an empty inbox"

echo "smoke: GET /api/v1/process-instances (scoped, filterable, bounded)"
status="$(request_as "$designer_jar" GET "/api/v1/process-instances?definitionKey=$process_key")"
[[ "$status" == "200" ]] || fail "listing process instances returned $status, expected 200"
python3 - "$body_file" "$process_key" "$designer_role" <<'PY' || fail "the instance list does not match the instances created above"
import json, sys

summaries = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
definition_key, approver_role = sys.argv[2], sys.argv[3]
if len(summaries) != 4:
    sys.exit(f"expected the four instances started in this run, got {len(summaries)}")
if any(summary["instance"]["definitionKey"] != definition_key for summary in summaries):
    sys.exit("the definition filter did not narrow the list")
started = [summary["instance"]["startedAt"] for summary in summaries]
if started != sorted(started, reverse=True):
    sys.exit("instances must be listed newest first")
waiting = [summary for summary in summaries if summary["instance"]["state"] == "running"]
if len(waiting) != 1 or [task["assigneeRole"] for task in waiting[0]["openTasks"]] != [approver_role]:
    sys.exit(f"the running instance should carry its open task: {waiting}")
print("smoke: the instance list is filtered, ordered and carries the waiting task")
PY

echo "smoke: the instance list follows record visibility and refuses bad filters"
status="$(request_as "$outsider_jar" GET "/api/v1/process-instances?definitionKey=$process_key")"
[[ "$status" == "200" ]] || fail "the outsider instance list returned $status"
grep -q '"data":\[\]' "$body_file" || fail "an outsider must not see instances of records they cannot read"
status="$(request_as "$designer_jar" GET '/api/v1/process-instances?objectKey=Not%20A%20Key')"
[[ "$status" == "400" ]] || fail "a malformed filter returned $status, expected 400"
grep -q 'object_key' "$body_file" || fail "the malformed filter did not name the parameter"
status="$(request GET "/api/v1/process-instances?definitionKey=$process_key")"
[[ "$status" == "401" ]] || fail "listing instances anonymously returned $status, expected 401"

echo "smoke: list pagination (page, total, search, and the bounds)"
# A second definition so a page has somewhere to move to; the cleanup script knows the prefix.
status="$(request_as "$designer_jar" POST /api/v1/business-objects \
  "$(printf '{"key":"smoke_page_%s","name":"Trang thử","fields":[{"key":"title","label":"Tiêu đề","type":"text","required":true}]}' "$stamp")")"
[[ "$status" == "201" ]] || fail "creating the paging fixture returned $status, expected 201"

status="$(request_as "$designer_jar" GET "/api/v1/business-objects?limit=1")"
[[ "$status" == "200" ]] || fail "listing with a limit returned $status, expected 200"
cp "$body_file" "$smoke_tmp_dir/page-first.json"
python3 - "$body_file" <<'PAGED' || fail "the page did not respect the limit"
import json, sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
if len(payload["data"]) != 1:
    sys.exit(f"limit=1 returned {len(payload['data'])} rows")
if payload["total"] < 2:
    sys.exit(f"the page must report the total behind it, got {payload.get('total')}")
print(f"smoke: one page carries {len(payload['data'])} row(s) of {payload['total']}")
PAGED

# At this size everything fits in one page, and the total is the number of rows: the count is
# the real one, not a copy of the page.
status="$(request_as "$designer_jar" GET "/api/v1/business-objects?limit=100")"
[[ "$status" == "200" ]] || fail "listing the whole page returned $status, expected 200"
python3 - "$body_file" <<'PAGED' || fail "the total does not match the rows on a full page"
import json, sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
if len(payload["data"]) != payload["total"]:
    sys.exit(f"a full page returned {len(payload['data'])} rows for a total of {payload['total']}")
print(f"smoke: the total ({payload['total']}) is the number of rows, not the page size")
PAGED

# Offset moves the page: the second row is not the first one.
status="$(request_as "$designer_jar" GET "/api/v1/business-objects?limit=1&offset=1")"
[[ "$status" == "200" ]] || fail "the second page returned $status, expected 200"
python3 - "$smoke_tmp_dir/page-first.json" "$body_file" <<'PAGED' || fail "offset did not move the page"
import json, sys

first = json.load(open(sys.argv[1], encoding="utf-8"))["data"][0]["key"]
second = json.load(open(sys.argv[2], encoding="utf-8"))["data"][0]["key"]
if first == second:
    sys.exit(f"offset=1 returned the same row as the first page ({first})")
print(f"smoke: offset moves the page ({first} -> {second})")
PAGED

# A search narrows the page to what it names.
status="$(request_as "$designer_jar" GET "/api/v1/business-objects?q=$object_key")"
[[ "$status" == "200" ]] || fail "a search returned $status, expected 200"
grep -q "\"key\":\"$object_key\"" "$body_file" || fail "the search did not find the object it named"
if grep -q "\"key\":\"smoke_page_$stamp\"" "$body_file"; then
  fail "the search returned an object it does not match"
fi

status="$(request_as "$designer_jar" GET "/api/v1/business-objects?limit=500")"
[[ "$status" == "400" ]] || fail "a limit above the cap returned $status, expected 400"
grep -q 'limit must be between' "$body_file" || fail "the refusal does not name the limit"
status="$(request_as "$designer_jar" GET "/api/v1/business-objects?limit=abc")"
[[ "$status" == "400" ]] || fail "a non-numeric limit returned $status, expected 400"
grep -q 'must be a whole number' "$body_file" || fail "the refusal does not explain the value"

echo "smoke: GET /api/v1/roles (the catalogue the designer offers)"
status="$(request_as "$designer_jar" GET /api/v1/roles)"
[[ "$status" == "200" ]] || fail "listing roles returned $status, expected 200"
grep -q '"total"' "$body_file" || fail "the role catalogue must say how many roles are behind the page"
grep -q "\"$designer_role\"" "$body_file" || fail "the role catalogue lost the designer's role"
grep -q "\"$director_role\"" "$body_file" || fail "the role catalogue lost the director's role"
python3 - "$body_file" <<'PY' || fail "the role catalogue is not sorted and distinct"
import json, sys

entries = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
keys = [entry["key"] for entry in entries]
if keys != sorted(set(keys)):
    sys.exit(f"expected roles sorted by key and distinct, got {keys}")
# Every entry carries the display name field, even when nobody has named the role yet:
# the interface shows the key then, rather than hiding the role (ADR 0016).
if any("label" not in entry for entry in entries):
    sys.exit(f"a role entry is missing its label field: {entries}")
print("smoke: the role catalogue is sorted and distinct")
PY
status="$(request GET /api/v1/roles)"
[[ "$status" == "401" ]] || fail "listing roles anonymously returned $status, expected 401"

echo "smoke: metrics (create, scoped result, validation, permissions)"
status="$(request_as "$designer_jar" GET /api/v1/metrics)"
[[ "$status" == "200" ]] || fail "listing metrics returned $status, expected 200"
grep -q '"total"' "$body_file" || fail "the metric list must say how many metrics are behind the page"
metric_key="smoke_amount_$stamp"
status="$(request_as "$designer_jar" POST /api/v1/metrics \
  "$(printf '{"key":"%s","name":"Tổng giá trị đề nghị","objectKey":"%s","aggregation":"sum","field":"amount"}' "$metric_key" "$object_key")")"
[[ "$status" == "201" ]] || fail "creating a metric returned $status, expected 201"
grep -q "\"aggregation\":\"sum\"" "$body_file" || fail "the created metric lost its aggregation"
grep -q '"kind":"number"' "$body_file" || fail "the created metric did not resolve the field kind"

# Two records exist by now: 1.500.000 on v1 and 5.000 on v2.
status="$(request_as "$designer_jar" GET "/api/v1/metrics/$metric_key/result")"
[[ "$status" == "200" ]] || fail "reading a metric result returned $status, expected 200"
python3 - "$body_file" <<'PY' || fail "the metric result does not match the stored records"
import json, sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
if result["total"] != 1505000 or result["records"] != 2:
    sys.exit(f'expected total 1505000 over 2 records, got {result["total"]} over {result["records"]}')
if result["buckets"]:
    sys.exit(f"a metric without grouping must not return buckets: {result['buckets']}")
print("smoke: the metric answered over the projected values")
PY

# The same metric over the same records, but scoped to another department: an outsider
# sees nothing, because a metric never widens what a person may read (ADR 0008).
status="$(request_as "$outsider_jar" GET "/api/v1/metrics/$metric_key/result")"
[[ "$status" == "200" ]] || fail "the outsider metric result returned $status"
python3 - "$body_file" <<'PY' || fail "a metric must be scoped like a record read"
import json, sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
if result["total"] != 0 or result["records"] != 0:
    sys.exit(f'expected an empty answer for an outsider, got {result["total"]} over {result["records"]}')
print("smoke: the metric is scoped to the caller's department")
PY

status="$(request_as "$designer_jar" POST /api/v1/metrics \
  "$(printf '{"key":"smoke_bad_metric_%s","name":"Sai","objectKey":"%s","aggregation":"sum","field":"note"}' "$stamp" "$object_key")")"
[[ "$status" == "400" ]] || fail "a sum over a text field returned $status, expected 400"
grep -q 'measures a number field' "$body_file" || fail "the invalid measure was not explained"
# `priority` only exists in version 1 of this object, so measuring it must be refused:
# the rule is about the schema in force, not about values that happen to be stored.
status="$(request_as "$designer_jar" POST /api/v1/metrics \
  "$(printf '{"key":"smoke_old_field_%s","name":"Sai","objectKey":"%s","aggregation":"count","groupBy":"priority"}' "$stamp" "$object_key")")"
[[ "$status" == "400" ]] || fail "grouping by a field of an older version returned $status, expected 400"
grep -q 'is not a field' "$body_file" || fail "the unknown grouping field was not explained"
status="$(request_as "$designer_jar" POST /api/v1/metrics \
  "$(printf '{"key":"smoke_unknown_field_%s","name":"Sai","objectKey":"%s","aggregation":"count","groupBy":"nope"}' "$stamp" "$object_key")")"
[[ "$status" == "400" ]] || fail "grouping by an unknown field returned $status, expected 400"
status="$(request_as "$outsider_jar" POST /api/v1/metrics \
  "$(printf '{"key":"smoke_denied_metric_%s","name":"Không được phép","objectKey":"%s","aggregation":"count"}' "$stamp" "$object_key")")"
[[ "$status" == "403" ]] || fail "creating a metric without a designer role returned $status, expected 403"
status="$(request GET "/api/v1/metrics/$metric_key/result")"
[[ "$status" == "401" ]] || fail "reading a metric anonymously returned $status, expected 401"

echo "smoke: process metrics (counts, rates, scope, guards)"
status="$(request_as "$designer_jar" GET "/api/v1/process-metrics?definitionKey=$process_key&windowDays=7")"
[[ "$status" == "200" ]] || fail "reading process metrics returned $status, expected 200"
python3 - "$body_file" "$process_key" <<'CHECK_PROCESS_METRICS'
import json, sys

overview = json.load(open(sys.argv[1], encoding="utf-8"))
expected_key, = sys.argv[2:3]
if overview["definitionKey"] != expected_key or overview["windowDays"] != 7:
    sys.exit(f"the response must report the window it answered for, got {overview['definitionKey']!r} {overview['windowDays']}")
counts = overview["instances"]
# Four instances were started in this run: two completed, one rejected, one returned and
# still running on attempt 2.
if counts["started"] != 4 or counts["completed"] != 2 or counts["rejected"] != 1 or counts["running"] != 1:
    sys.exit(f"unexpected instance counts: {counts}")
if overview["approvalRate"] != 2 / 3:
    sys.exit(f"expected approval rate 2/3, got {overview['approvalRate']}")
if overview["reworkRate"] != 0.25:
    sys.exit(f"expected rework rate 1/4, got {overview['reworkRate']}")
if overview["cycleTime"]["samples"] < 2 or overview["stepTime"]["samples"] < 3:
    sys.exit(f"expected durations with samples, got {overview['cycleTime']} / {overview['stepTime']}")
print("smoke: process metrics match the instances this run created")
CHECK_PROCESS_METRICS

# The same call as another department: the metrics are scoped like any other read, so the
# outsider sees nothing of these instances.
status="$(request_as "$outsider_jar" GET "/api/v1/process-metrics?definitionKey=$process_key&windowDays=7")"
[[ "$status" == "200" ]] || fail "the outsider process metrics returned $status"
grep -q '"started":0' "$body_file" || fail "an outsider must not see instances of records they cannot read"
if grep -q '"approvalRate"' "$body_file"; then
  fail "a rate over nothing must be absent, not reported"
fi

status="$(request_as "$designer_jar" GET "/api/v1/process-metrics?windowDays=400")"
[[ "$status" == "400" ]] || fail "a 400-day window returned $status, expected 400"
grep -q 'window_days' "$body_file" || fail "the invalid window did not name the parameter"
status="$(request_as "$designer_jar" GET "/api/v1/process-metrics?definitionKey=Not%20A%20Key")"
[[ "$status" == "400" ]] || fail "a malformed definition filter returned $status, expected 400"
status="$(request_as "$designer_jar" GET "/api/v1/process-metrics?definitionKey=smoke_missing_$stamp")"
[[ "$status" == "404" ]] || fail "an unknown definition filter returned $status, expected 404"
status="$(request GET /api/v1/process-metrics)"
[[ "$status" == "401" ]] || fail "reading process metrics anonymously returned $status, expected 401"

echo "smoke: outbound webhook (queued with the event, retried, delivered, signed)"
# The first instance started above queued notifications and the receiver refuses the first
# request it sees, so a row for *this run's* instance with attempts 2 and status delivered
# is the proof that the retry happened without the decision waiting for it (ADR 0012).
# The wait is scoped to that instance: rows an earlier run left in a shared database must
# not answer for this one.
for _ in $(seq 1 30); do
  status="$(request_as "$designer_jar" GET /api/v1/webhook-deliveries)"
  [[ "$status" == "200" ]] || fail "reading the delivery log returned $status"
  if python3 - "$body_file" "$instance_id" <<'PY'
import json, sys

rows = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
if any(r["instanceId"] == sys.argv[2] and r["status"] == "delivered" and r["attempts"] == 2 for r in rows):
    sys.exit(0)
sys.exit(1)
PY
  then
    break
  fi
  sleep 1
done
python3 - "$body_file" "$instance_id" <<'PY' || fail "the refused delivery of this run's instance was not retried to delivered"
import json, sys

rows = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
mine = [r for r in rows if r["instanceId"] == sys.argv[2]]
if not mine:
    sys.exit("no delivery was recorded for the instance this run started")
if not any(r["status"] == "delivered" and r["attempts"] == 2 for r in mine):
    sys.exit(f"expected a delivered row after 2 attempts, got {mine}")
print(f"smoke: the refused notification was retried and delivered ({len(mine)} deliveries for this instance)")
PY
grep -q '"enabled":true' "$body_file" || fail "the delivery log must report that the integration is on"

# The receiver holds every delivery this run made, and the run's own rejection lands last:
# assert over the whole set, never over the last line (which event arrives last is timing).
python3 - "$receiver_file" <<'CHECK_WEBHOOK_RECEIVER'
import hashlib, hmac, json, sys

lines = [json.loads(line) for line in open(sys.argv[1], encoding="utf-8")]
if not lines:
    sys.exit("the receiver got nothing")
payloads = [json.loads(line["body"]) for line in lines]
events = {payload["event"] for payload in payloads}
if not events & {"instance_started", "task_created"}:
    sys.exit(f"no start or task event reached the receiver, only {sorted(events)}")
for line, payload in zip(lines, payloads):
    if "instance" not in payload or "definitionKey" not in payload["instance"]:
        sys.exit(f"a payload does not describe the instance: {payload}")
    expected = "sha256=" + hmac.new(b"smoke-webhook-secret", line["body"].encode("utf-8"), hashlib.sha256).hexdigest()
    if line["signature"] != expected:
        sys.exit(f"a signature does not match the body and the shared secret: {line['signature']!r}")
print(f"smoke: the receiver accepted {len(lines)} signed notifications ({', '.join(sorted(events))})")
CHECK_WEBHOOK_RECEIVER

echo "smoke: the delivery log says how many deliveries are behind the page"
status="$(request_as "$designer_jar" GET /api/v1/webhook-deliveries)"
[[ "$status" == "200" ]] || fail "listing the delivery log returned $status, expected 200"
grep -q '"total"' "$body_file" || fail "the delivery log must say how many deliveries are behind the page"

echo "smoke: administration is administrators only (ADR 0022)"
status="$(request_as "$designer_jar" GET /api/v1/admin/users)"
[[ "$status" == "403" ]] || fail "listing accounts as a non-admin returned $status, expected 403"
grep -q '"code":"forbidden"' "$body_file" || fail "the admin check did not return the forbidden code"
status="$(request_as "$admin_jar" GET /api/v1/admin/users)"
[[ "$status" == "200" ]] || fail "listing accounts as an administrator returned $status, expected 200"
grep -q "$designer_email" "$body_file" || fail "the account list does not contain the designer"

echo "smoke: administration creates a department, a role and an account through the API"
admin_department="smoke_admin_dept_$stamp"
status="$(request_as "$admin_jar" POST /api/v1/admin/departments \
  "$(printf '{"key":"%s","name":"Smoke admin %s"}' "$admin_department" "$stamp")")"
[[ "$status" == "201" ]] || fail "creating a department through the admin API returned $status, expected 201"
grep -q "\"key\":\"$admin_department\"" "$body_file" || fail "the created department is missing from the response"

admin_role="smoke_admin_role_$stamp"
status="$(request_as "$admin_jar" POST /api/v1/admin/roles \
  "$(printf '{"key":"%s","label":"Smoke vai tro %s"}' "$admin_role" "$stamp")")"
[[ "$status" == "201" ]] || fail "creating a role through the admin API returned $status, expected 201"
grep -q '"userCount":0' "$body_file" || fail "a role created before anyone holds it must report zero holders"

admin_user_email="adminuser_$stamp@example.com"
admin_user_password="smoke-admin-password"
status="$(request_as "$admin_jar" POST /api/v1/admin/users \
  "$(printf '{"email":"%s","name":"Smoke admin user","password":"%s","department":"%s","roles":["%s"]}' \
    "$admin_user_email" "$admin_user_password" "$admin_department" "$admin_role")")"
[[ "$status" == "201" ]] || fail "creating an account through the admin API returned $status, expected 201"
grep -q "$admin_user_email" "$body_file" || fail "the created account is missing from the response"
admin_user_id="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["id"])' "$body_file")"

admin_user_jar="$smoke_tmp_dir/adminuser.cookies"
status="$(login_as "$admin_user_jar" "$admin_user_email" "$admin_user_password")"
[[ "$status" == "200" ]] || fail "the account created through the API could not sign in (status $status)"

echo "smoke: two-step verification (ADR 0030)"
status="$(request_as "$admin_jar" GET /api/v1/me/two-factor)"
[[ "$status" == "200" ]] || fail "reading the two-step state returned $status, expected 200"
grep -q '"enabled":false' "$body_file" || fail "an account without the second step must report it"

# The administrator enrols an authenticator app: the secret comes once, the app's code
# switches the second step on, and the recovery codes come once.
status="$(request_as "$admin_jar" POST /api/v1/me/two-factor)"
[[ "$status" == "200" ]] || fail "setting up the second step returned $status, expected 200"
totp_secret="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["secret"])' "$body_file")"
[[ -n "$totp_secret" ]] || fail "the setup did not hand out a secret"
totp_code="$(python3 - "$totp_secret" <<'TOTP'
import base64, hashlib, hmac, struct, sys, time

secret = base64.b32decode(sys.argv[1] + "=" * ((8 - len(sys.argv[1]) % 8) % 8))
counter = struct.pack(">Q", int(time.time()) // 30)
digest = hmac.new(secret, counter, hashlib.sha1).digest()
offset = digest[-1] & 0x0F
value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
print(f"{value % 1000000:06d}")
TOTP
)"
status="$(request_as "$admin_jar" POST /api/v1/me/two-factor/enable "{\"code\":\"$totp_code\"}")"
[[ "$status" == "200" ]] || fail "enabling the second step returned $status, expected 200"
python3 - "$body_file" <<'PY' || fail "the recovery codes are missing"
import json, sys

codes = json.load(open(sys.argv[1], encoding="utf-8"))["recoveryCodes"]
if len(codes) != 8:
    sys.exit(f"expected 8 recovery codes, got {len(codes)}")
PY

# From now on the sign-in needs the code as well.
status="$(login_as "$smoke_tmp_dir/twofactor.cookies" "$admin_email" "$smoke_password")"
[[ "$status" == "401" ]] || fail "a sign-in without the code returned $status, expected 401"
grep -q '"code":"two_factor_required"' "$body_file" ||
  fail "the sign-in must ask for the code"

# And the right code opens the session.
status="$(request_as "$admin_jar" POST /api/v1/auth/login \
  "$(printf '{"email":"%s","password":"%s","code":"%s"}' "$admin_email" "$smoke_password" "$totp_code")")"
[[ "$status" == "200" ]] || fail "a sign-in with the code returned $status, expected 200"

# The administrator turns it off again for their own account.
status="$(request_as "$admin_jar" POST /api/v1/me/two-factor/disable "{\"code\":\"$totp_code\"}")"
[[ "$status" == "204" ]] || fail "turning the second step off returned $status, expected 204"
status="$(request_as "$admin_jar" GET /api/v1/me/two-factor)"
grep -q '"enabled":false' "$body_file" || fail "the second step is still on"

echo "smoke: repeated failures trigger the cooldown, and the API and the CLI lift it"
for _ in 1 2 3 4 5; do
  status="$(login_as "$smoke_tmp_dir/cooldown.cookies" "$admin_user_email" "not-the-password")"
  [[ "$status" == "401" ]] || fail "a wrong password returned $status, expected 401"
done
status="$(login_as "$smoke_tmp_dir/cooldown.cookies" "$admin_user_email" "$admin_user_password")"
[[ "$status" == "401" ]] ||
  fail "the correct password must be refused during the cooldown (status $status)"
grep -q '"code":"unauthorized"' "$body_file" ||
  fail "the cooldown must answer with the same unauthorized envelope"

status="$(request_as "$admin_jar" GET "/api/v1/admin/users?q=$admin_user_email")"
[[ "$status" == "200" ]] || fail "listing the waiting account returned $status, expected 200"
grep -q '"lockedUntil"' "$body_file" ||
  fail "the waiting account must say when its cooldown ends"

useradm -list-lockouts | grep -q "$admin_user_email" ||
  fail "the CLI must list the address that is waiting out a cooldown"

status="$(request_as "$designer_jar" POST "/api/v1/admin/users/$admin_user_id/unlock")"
[[ "$status" == "403" ]] || fail "unlocking as a non-admin returned $status, expected 403"

status="$(request_as "$admin_jar" POST "/api/v1/admin/users/$admin_user_id/unlock")"
[[ "$status" == "204" ]] || fail "unlocking through the API returned $status, expected 204"
status="$(login_as "$smoke_tmp_dir/cooldown.cookies" "$admin_user_email" "$admin_user_password")"
[[ "$status" == "200" ]] || fail "the unlocked account could not sign in (status $status)"

status="$(request_as "$admin_jar" GET "/api/v1/admin/users?q=$admin_user_email")"
if grep -q '"lockedUntil"' "$body_file"; then
  fail "an unlocked account must no longer report a cooldown"
fi

useradm -unlock -email "$admin_user_email" >/dev/null || fail "unlocking the address failed"
useradm -prune-login-failures >/dev/null || fail "pruning sign-in failures failed"

echo "smoke: an account without a role is refused and a missing account answers 404"
status="$(request_as "$admin_jar" POST /api/v1/admin/users \
  "$(printf '{"email":"norole_%s@example.com","name":"No role","password":"%s","department":"%s","roles":[]}' \
    "$stamp" "$smoke_password" "$admin_department")")"
[[ "$status" == "400" ]] || fail "creating an account without roles returned $status, expected 400"
status="$(request_as "$admin_jar" GET "/api/v1/admin/users/$(python3 -c 'import uuid; print(uuid.uuid4())')")"
[[ "$status" == "404" ]] || fail "reading an unknown account returned $status, expected 404"

echo "smoke: an account in use and a role in use cannot be deleted -> 409 in_use"
status="$(request_as "$admin_jar" DELETE "/api/v1/admin/departments/$admin_department")"
[[ "$status" == "409" ]] || fail "deleting a department with people returned $status, expected 409"
grep -q '"code":"in_use"' "$body_file" || fail "the department guard did not return the in_use code"
status="$(request_as "$admin_jar" DELETE "/api/v1/admin/roles/$admin_role")"
[[ "$status" == "409" ]] || fail "deleting a role somebody holds returned $status, expected 409"
grep -q '"code":"in_use"' "$body_file" || fail "the role guard did not return the in_use code"

echo "smoke: an empty department and an unheld role can be deleted"
empty_department="smoke_empty_dept_$stamp"
[[ "$(request_as "$admin_jar" POST /api/v1/admin/departments \
  "$(printf '{"key":"%s","name":"Smoke empty %s"}' "$empty_department" "$stamp")")" == "201" ]] ||
  fail "creating the empty department failed"
[[ "$(request_as "$admin_jar" DELETE "/api/v1/admin/departments/$empty_department")" == "204" ]] ||
  fail "deleting an empty department did not return 204"
empty_role="smoke_empty_role_$stamp"
[[ "$(request_as "$admin_jar" POST /api/v1/admin/roles \
  "$(printf '{"key":"%s","label":"Smoke empty role %s"}' "$empty_role" "$stamp")")" == "201" ]] ||
  fail "creating the unheld role failed"
[[ "$(request_as "$admin_jar" DELETE "/api/v1/admin/roles/$empty_role")" == "204" ]] ||
  fail "deleting an unheld role did not return 204"

echo "smoke: a password reset ends the old session, and the new password works"
new_password="smoke-reset-password"
status="$(request_as "$admin_jar" POST "/api/v1/admin/users/$admin_user_id/password" \
  "$(printf '{"password":"%s"}' "$new_password")")"
[[ "$status" == "204" ]] || fail "setting a password returned $status, expected 204"
status="$(request_as "$admin_user_jar" GET /api/v1/me)"
[[ "$status" == "401" ]] || fail "the old session survived a password reset (status $status)"
status="$(login_as "$admin_user_jar" "$admin_user_email" "$new_password")"
[[ "$status" == "200" ]] || fail "signing in with the new password returned $status"

echo "smoke: revoking sessions signs the person out without touching the password"
status="$(request_as "$admin_jar" DELETE "/api/v1/admin/users/$admin_user_id/sessions")"
[[ "$status" == "204" ]] || fail "revoking sessions returned $status, expected 204"
status="$(request_as "$admin_user_jar" GET /api/v1/me)"
[[ "$status" == "401" ]] || fail "the revoked session is still accepted (status $status)"

echo "smoke: updating an account replaces its profile and roles"
status="$(request_as "$admin_jar" PUT "/api/v1/admin/users/$admin_user_id" \
  "$(printf '{"email":"%s","name":"Smoke admin user (v2)","department":"%s","roles":["%s"],"status":"disabled"}' \
    "$admin_user_email" "$admin_department" "$admin_role")")"
[[ "$status" == "200" ]] || fail "updating an account returned $status, expected 200"
grep -q 'Smoke admin user (v2)' "$body_file" || fail "the updated name is missing from the response"
status="$(request_as "$admin_jar" PUT "/api/v1/admin/users/$(python3 -c 'import uuid; print(uuid.uuid4())')" \
  "$(printf '{"email":"nobody_%s@example.com","name":"Nobody","department":"%s","roles":["%s"],"status":"active"}' \
    "$stamp" "$admin_department" "$admin_role")")"
[[ "$status" == "404" ]] || fail "updating an unknown account returned $status, expected 404"

echo "smoke: logout ends the session"
status="$(request_as "$designer_jar" POST /api/v1/auth/logout)"
[[ "$status" == "204" ]] || fail "logout returned $status, expected 204"
status="$(request_as "$designer_jar" GET /api/v1/me)"
[[ "$status" == "401" ]] || fail "/me after logout returned $status, expected 401"

echo "smoke: unknown instance and malformed id -> 404 and 400"
status="$(request_as "$director_jar" GET "/api/v1/process-instances/$(python3 -c 'import uuid; print(uuid.uuid4())')")"
[[ "$status" == "404" ]] || fail "reading an unknown instance returned $status, expected 404"
status="$(request_as "$director_jar" GET "/api/v1/process-instances/not-a-uuid")"
[[ "$status" == "400" ]] || fail "a malformed instance id returned $status, expected 400"


echo "smoke: a caller without a designer role cannot change definitions -> 403"
status="$(request_as "$outsider_jar" POST /api/v1/business-objects '{"key":"smoke_denied_'"$stamp"'","name":"Không được phép"}')"
[[ "$status" == "403" ]] || fail "creating a definition without a designer role returned $status, expected 403"
grep -q '"code":"forbidden"' "$body_file" || fail "the designer check did not return the forbidden code"

echo "smoke: department scope on records (ADR 0008)"
status="$(request_as "$outsider_jar" GET "/api/v1/business-objects/$object_key/records")"
[[ "$status" == "200" ]] || fail "listing records as another department returned $status"
grep -q '"data":\[\]' "$body_file" || fail "another department must not see the designer's records"
status="$(request_as "$admin_jar" GET "/api/v1/business-objects/$object_key/records")"
[[ "$status" == "200" ]] || fail "listing records as an administrator returned $status"
grep -q '"amount":1500000' "$body_file" || fail "an administrator must see every department's records"

echo "smoke: GET /api/v1/does-not-exist (unknown route -> 404 envelope)"
status="$(request GET /api/v1/does-not-exist)"
[[ "$status" == "404" ]] || fail "unknown route returned $status, expected 404"
grep -q '"code":"not_found"' "$body_file" || fail "unknown route did not return the not_found error code"

# The run tidied up at the start; a run that passed tidies up after itself too, so a screen
# someone opens next does not show this run's rows. A run that failed keeps its evidence.
bash "$root_dir/scripts/clean-smoke-data.sh" >/dev/null 2>&1 ||
  echo "smoke: could not clean up after the run — run 'make clean-smoke-data' by hand"

echo "smoke: PASS"
