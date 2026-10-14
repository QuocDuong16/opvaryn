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
if any(version["publishedBy"] != "system" for version in versions):
    sys.exit("publishing should be attributed to system until identity exists")
newest = [field["key"] for field in versions[0]["fields"]]
oldest = [field["key"] for field in versions[-1]["fields"]]
if newest != ["amount", "note"] or oldest != ["amount", "priority"]:
    sys.exit(f"version schemas are wrong: newest {newest}, oldest {oldest}")
print("smoke: version history verified")
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

echo "smoke: GET /api/v1/roles (the catalogue the designer offers)"
status="$(request_as "$designer_jar" GET /api/v1/roles)"
[[ "$status" == "200" ]] || fail "listing roles returned $status, expected 200"
grep -q "\"$designer_role\"" "$body_file" || fail "the role catalogue lost the designer's role"
grep -q "\"$director_role\"" "$body_file" || fail "the role catalogue lost the director's role"
python3 - "$body_file" <<'PY' || fail "the role catalogue is not sorted and distinct"
import json, sys

roles = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
if roles != sorted(set(roles)):
    sys.exit(f"expected sorted distinct roles, got {roles}")
print("smoke: the role catalogue is sorted and distinct")
PY
status="$(request GET /api/v1/roles)"
[[ "$status" == "401" ]] || fail "listing roles anonymously returned $status, expected 401"

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

echo "smoke: PASS"
