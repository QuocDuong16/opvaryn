#!/usr/bin/env bash
#
# Evidence for MVP acceptance criterion #7: a restart does not lose workflow state and a
# retry does not create a duplicate side effect.
#
# The script builds the API, drives one instance to a decided state, then **kills the
# process with SIGKILL** — a crash, not a graceful stop — starts a fresh one against the
# same database, and checks three things:
#
#   1. the instance reads back exactly as it was (state, node, attempt, task statuses and
#      the whole event log), because state lives in PostgreSQL and nowhere else;
#   2. the inbox still offers the work the process is waiting on;
#   3. re-sending the decision that was already applied answers 409 and leaves the event
#      log at one approval — the compare-and-swap is what makes a retry harmless.
#
# Requires: PostgreSQL running and migrated (make docker-up; cd apps/api && go run
# ./cmd/migrate).
#
# Usage: bash scripts/smoke-restart.sh   (or: make smoke-restart)
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_dir="$root_dir/apps/api"
tmp_dir="$(mktemp -d -t opvaryn-restart.XXXXXX)"
api_log="$tmp_dir/api.log"
api_base="${API_BASE_URL:-http://localhost:21501}"
api_port="${api_base##*:}"
api_pid=""

fail() {
  echo "restart: FAIL: $*" >&2
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
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

start_api() {
  "$api_dir/bin/server" >>"$api_log" 2>&1 &
  api_pid=$!
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null "$api_base/readyz" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  fail "the API did not become ready at $api_base"
}

# request <jar|-> <method> <path> [json] -> writes the body to $tmp_dir/body.json
request() {
  local jar="$1" method="$2" path="$3" json="${4:-}"
  local cookies=()
  if [[ "$jar" != "-" ]]; then
    cookies=(-b "$jar" -c "$jar")
  fi
  if [[ -n "$json" ]]; then
    curl -sS -o "$tmp_dir/body.json" -w '%{http_code}' -X "$method" "$api_base$path" \
      "${cookies[@]}" -H 'Content-Type: application/json' -d "$json"
  else
    curl -sS -o "$tmp_dir/body.json" -w '%{http_code}' -X "$method" "$api_base$path" "${cookies[@]}"
  fi
}

if curl -sf -o /dev/null "$api_base/healthz" 2>/dev/null; then
  fail "another API already answers on $api_base — stop it before running this script"
fi

# Leftovers from earlier runs made the Data screen unreadable (118 objects after a day), so
# every run tidies up first. Only smoke-tagged rows are removed: make clean-smoke-data does the
# same thing by hand, and the pilot data never matches.
sh "$root_dir/scripts/clean-smoke-data.sh" >/dev/null 2>&1 ||
  echo "smoke: could not clean leftovers from earlier runs (is Postgres up?)"

echo "restart: building the API"
(cd "$api_dir" && go build -o bin/server ./cmd/server)
(cd "$api_dir" && go build -o bin/useradm ./cmd/useradm)

stamp="$(date +%s)"
password="restart-test-password"
department="restart_dept_$stamp"
designer_email="restart_designer_$stamp@example.com"
approver_role="restart_approver_$stamp"
object_key="restart_object_$stamp"
process_key="restart_flow_$stamp"

echo "restart: preparing an account and a process"
(cd "$api_dir" && ./bin/useradm -create-department -key "$department" -department-name "Restart $stamp") >/dev/null
(cd "$api_dir" && ./bin/useradm -create -email "$designer_email" -name "Restart tester" \
  -password "$password" -department "$department" -roles "process_designer,$approver_role") >/dev/null

start_api
jar="$tmp_dir/designer.cookies"
# The jar is written by this call: the session cookie is what every later request uses.
status="$(request "$jar" POST /api/v1/auth/login "$(printf '{"email":"%s","password":"%s"}' "$designer_email" "$password")")"
[[ "$status" == "200" ]] || fail "signing in returned $status"

status="$(request "$jar" POST /api/v1/business-objects \
  "$(printf '{"key":"%s","name":"Restart object","fields":[{"key":"title","label":"Nội dung","type":"text","required":true},{"key":"amount","label":"Giá trị","type":"number","required":true}]}' "$object_key")")"
[[ "$status" == "201" ]] || fail "creating the object returned $status"

status="$(request "$jar" POST /api/v1/process-definitions \
  "$(printf '{"key":"%s","name":"Restart flow","objectKey":"%s","nodes":[{"key":"start","type":"start","title":"Nhận"},{"key":"first","type":"human_task","title":"Bước một","assigneeRole":"%s"},{"key":"second","type":"human_task","title":"Bước hai","assigneeRole":"%s"},{"key":"end","type":"end","title":"Kết thúc"}],"edges":[{"from":"start","to":"first"},{"from":"first","to":"second"},{"from":"second","to":"end"}]}' "$process_key" "$object_key" "$approver_role" "$approver_role")")"
[[ "$status" == "201" ]] || fail "creating the definition returned $status"

status="$(request "$jar" POST "/api/v1/business-objects/$object_key/records" '{"values":{"title":"Kiểm tra restart","amount":42}}')"
[[ "$status" == "201" ]] || fail "creating the record returned $status"
record_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$tmp_dir/body.json")"

status="$(request "$jar" POST /api/v1/process-instances \
  "$(printf '{"definitionKey":"%s","recordId":"%s"}' "$process_key" "$record_id")")"
[[ "$status" == "201" ]] || fail "starting the instance returned $status"
instance_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["instance"]["id"])' "$tmp_dir/body.json")"
task_id="$(python3 -c 'import json,sys; print(next(t["id"] for t in json.load(open(sys.argv[1]))["tasks"] if t["status"]=="open"))' "$tmp_dir/body.json")"

echo "restart: deciding the first step"
status="$(request "$jar" POST "/api/v1/process-instances/$instance_id/tasks/$task_id/decisions" '{"decision":"approve"}')"
[[ "$status" == "200" ]] || fail "the first decision returned $status"

# The state to compare against, taken while the process that produced it is still alive.
curl -sS -b "$jar" -o "$tmp_dir/before.json" "$api_base/api/v1/process-instances/$instance_id"
curl -sS -b "$jar" -o "$tmp_dir/inbox-before.json" "$api_base/api/v1/tasks"

echo "restart: killing the API with SIGKILL (a crash, not a graceful stop)"
kill -KILL "$api_pid"
wait "$api_pid" 2>/dev/null || true
api_pid=""

start_api

echo "restart: comparing the state after the restart"
curl -sS -b "$jar" -o "$tmp_dir/after.json" "$api_base/api/v1/process-instances/$instance_id"
python3 - "$tmp_dir/before.json" "$tmp_dir/after.json" <<'COMPARE_STATE'
import json, sys

before = json.load(open(sys.argv[1], encoding="utf-8"))
after = json.load(open(sys.argv[2], encoding="utf-8"))
if before["instance"] != after["instance"]:
    sys.exit(f"the instance changed across the restart:\n{before['instance']}\n{after['instance']}")
if before["tasks"] != after["tasks"]:
    sys.exit("the tasks changed across the restart")
if before["events"] != after["events"]:
    sys.exit("the event log changed across the restart")
print(f"restart: instance, {len(after['tasks'])} task(s) and {len(after['events'])} event(s) survived unchanged")
COMPARE_STATE

curl -sS -b "$jar" -o "$tmp_dir/inbox-after.json" "$api_base/api/v1/tasks"
python3 - "$tmp_dir/inbox-before.json" "$tmp_dir/inbox-after.json" <<'COMPARE_INBOX'
import json, sys

before = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
after = json.load(open(sys.argv[2], encoding="utf-8"))["data"]
if [item["task"]["id"] for item in before] != [item["task"]["id"] for item in after]:
    sys.exit(f"the inbox changed across the restart: {before} -> {after}")
print(f"restart: the inbox still offers the same {len(after)} open task(s)")
COMPARE_INBOX

echo "restart: retrying the decision that was already applied"
status="$(request "$jar" POST "/api/v1/process-instances/$instance_id/tasks/$task_id/decisions" '{"decision":"approve"}')"
[[ "$status" == "409" ]] || fail "a retried decision returned $status, expected 409"
grep -q '"code":"conflict"' "$tmp_dir/body.json" || fail "the retry did not return the conflict error code"

curl -sS -b "$jar" -o "$tmp_dir/after-retry.json" "$api_base/api/v1/process-instances/$instance_id"
python3 - "$tmp_dir/after.json" "$tmp_dir/after-retry.json" <<'CHECK_RETRY'
import json, sys

before = json.load(open(sys.argv[1], encoding="utf-8"))
after = json.load(open(sys.argv[2], encoding="utf-8"))
if before["instance"] != after["instance"] or before["tasks"] != after["tasks"]:
    sys.exit("the retried decision changed the instance")
approvals = [event for event in after["events"] if event["type"] == "task_approved"]
if len(approvals) != 1:
    sys.exit(f"expected exactly one approval event after the retry, got {len(approvals)}")
print("restart: the retry was refused and the audit log still has one approval")
CHECK_RETRY

echo "restart: PASS — state survives a crash, and a retry cannot apply twice"
