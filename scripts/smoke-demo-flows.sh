#!/usr/bin/env bash
#
# End-to-end smoke test for the demo flows that live in the web app.
#
# The entry forms, the object builder and the dashboard layout are React server
# actions, so the API smoke test cannot reach them. This script drives them the
# way a browser without JavaScript does: it renders the page, reads the form's
# progressive-enhancement fields, replays the POST, and then verifies the result
# twice — through the API (was the row stored?) and through the re-rendered page
# (does the user see it?).
#
# The script builds and starts both servers itself and refuses to run when
# something already answers on their ports, so stop any dev server first.
#
# Requires: PostgreSQL running and migrated (make docker-up; cd apps/api && go run
# ./cmd/migrate) and web dependencies installed (pnpm install).
#
# Usage: bash scripts/smoke-demo-flows.sh   (or: make smoke-demo-flows)
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_dir="$root_dir/apps/api"
web_dir="$root_dir/apps/web"
tmp_dir="$(mktemp -d -t opvaryn-flows.XXXXXX)"
api_log="$tmp_dir/api.log"
web_log="$tmp_dir/web.log"
cookie_jar="$tmp_dir/cookies.txt"
api_base="${API_BASE_URL:-http://localhost:21501}"
web_base="${WEB_BASE_URL:-http://localhost:21500}"
api_port="${api_base##*:}"
web_port="${web_base##*:}"
api_pid=""
web_pid=""

fail() {
  echo "flows: FAIL: $*" >&2
  for log in "$api_log" "$web_log"; do
    if [[ -s "$log" ]]; then
      echo "--- ${log##*/} (last 15 lines) ---" >&2
      tail -n 15 "$log" >&2
    fi
  done
  exit 1
}

# kill_listener stops everything listening on a port this script verified was free
# at start. Servers are stopped by the pid that owns the port, never by a pattern:
# a pattern like "next start" also matches the invoking shell's own command line.
kill_listener() {
  local port="$1" label="$2" pids pid
  pids="$(ss -ltnp 2>/dev/null | grep -E ":$port( |$)" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  [[ -n "$pids" ]] || return 0

  for pid in $pids; do
    echo "flows: stopping the $label server (pid $pid, port $port)"
    kill -TERM "$pid" 2>/dev/null || true
  done
  for _ in $(seq 1 10); do
    ss -ltnp 2>/dev/null | grep -qE ":$port( |$)" || return 0
    sleep 0.5
  done
  for pid in $pids; do
    kill -KILL "$pid" 2>/dev/null || true
  done
}

cleanup() {
  kill_listener "$web_port" "web"
  kill_listener "$api_port" "API"
  for pid in "$web_pid" "$api_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

# ---------------------------------------------------------------- helpers ----

# assert_contains <file> <text> <label>
assert_contains() {
  grep -qF -- "$2" "$1" || fail "$3: expected to find \"$2\" in ${1##*/}"
}

# assert_status <actual> <expected> <label>
assert_status() {
  [[ "$1" == "$2" ]] || fail "$3: expected HTTP $2, got $1"
}

# assert_not_contains <file> <text> <label> -> fails when the literal is present
assert_not_contains() {
  if grep -qF -- "$2" "$1"; then
    fail "$3: did not expect to find \"$2\" in ${1##*/}"
  fi
}

# count_occurrences <file> <text> -> prints how many times a literal appears
count_occurrences() {
  grep -oF -- "$2" "$1" | wc -l | tr -d ' '
}

# web_get <path> <outfile> -> status code; keeps cookies, because since ADR 0008 the
# demo screens need a session like any other caller.
web_get() {
  web_get_as "$cookie_jar" "$1" "$2"
}

# web_get_as <jar> <path> <outfile> -> status code; a second person needs a second jar.
web_get_as() {
  curl -sS -o "$3" -w '%{http_code}' "${web_base}$2" -b "$1" -c "$1"
}

# web_post <path> <outfile> [--form-string ...] -> status code; keeps cookies so
# the dashboard-layout flow can prove the cookie round-trip.
web_post() {
  local path="$1" out="$2"
  shift 2
  web_post_as "$cookie_jar" "$path" "$out" "$@"
}

# web_post_as <jar> <path> <outfile> [--form-string ...] -> status code
web_post_as() {
  local jar="$1" path="$2" out="$3"
  shift 3
  curl -sS -o "$out" -w '%{http_code}' -X POST "${web_base}${path}" \
    -H "Origin: $web_base" -c "$jar" -b "$jar" "$@"
}

# sign_in_through_form <jar> <email> <password> <label> -> signs in as a person by
# replaying the real login form, exactly like a browser without JavaScript.
sign_in_through_form() {
  local jar="$1" email="$2" password="$3" label="$4"
  local page="$tmp_dir/login-$label.html" response="$tmp_dir/signed-in-$label.html"
  local status args
  status="$(web_get_as "$jar" "/login" "$page")"
  assert_status "$status" "200" "$label login page"
  mapfile -t args < <(form_args "$page" password)
  [[ ${#args[@]} -ge 4 ]] || fail "[$label] the login form has no server-action fields"
  status="$(web_post_as "$jar" "/login" "$response" \
    "${args[@]}" \
    --form-string "email=$email" \
    --form-string "password=$password")"
  # The action answers 303 back to the shell after storing the session cookie; curl
  # does not follow redirects, so the redirect itself is the success signal.
  assert_status "$status" "303" "$label sign in"
  grep -q 'opvaryn.session' "$jar" || fail "[$label] the web app did not set a session cookie"
}

# form_fields <html-file> <marker-input> [exclude...] -> "name\tvalue" per hidden field
form_fields() {
  python3 - "$@" <<'PY'
import html, re, sys

path, marker = sys.argv[1], sys.argv[2]
excluded = set(sys.argv[3:])
page = open(path, encoding="utf-8").read()

form = None
for candidate in re.findall(r"<form[^>]*>[\s\S]*?</form>", page):
    if f'name="{marker}"' in candidate:
        form = candidate
        break
if form is None:
    sys.exit(f"flows: no form containing input {marker!r} on {path}")

for tag in re.findall(r'<input type="hidden"[^>]*>', form):
    name = re.search(r'name="([^"]+)"', tag).group(1)
    if name in excluded:
        continue
    value = re.search(r'value="([^"]*)"', tag)
    print(f"{name}\t{html.unescape(value.group(1)) if value else ''}")
PY
}

# form_args <html-file> <marker-input> [exclude...] -> prints "--form-string\nname=value" lines
form_args() {
  local file="$1" marker="$2"
  shift 2
  local name value
  while IFS=$'\t' read -r name value; do
    printf '%s\n' '--form-string' "$name=$value"
  done < <(form_fields "$file" "$marker" "$@")
}

wait_for_http() {
  local url="$1" tries="$2" label="$3"
  for _ in $(seq 1 "$tries"); do
    if curl -s -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  fail "$label did not answer at $url"
}

# ------------------------------------------------------------------ setup ----

[[ -d "$web_dir/node_modules" ]] || fail "web dependencies are missing — run 'pnpm install' first."

if curl -sf -o /dev/null "$api_base/healthz" 2>/dev/null; then
  fail "another API already answers on $api_base — stop it before running this script"
fi
if curl -sf -o /dev/null "$web_base/" 2>/dev/null; then
  fail "another web server already answers on $web_base — stop it before running this script"
fi

echo "flows: building the API"
(cd "$api_dir" && go build -o bin/server ./cmd/server)

echo "flows: building the web app (next build)"
(cd "$web_dir" && pnpm build >"$web_log" 2>&1) || fail "next build failed — see the app log"
: >"$web_log"

echo "flows: starting the API"
"$api_dir/bin/server" >"$api_log" 2>&1 &
api_pid=$!
wait_for_http "$api_base/readyz" 30 "the API"
curl -sf -o /dev/null "$api_base/readyz" ||
  fail "the API is not ready — is PostgreSQL running (make docker-up) and migrated?"

echo "flows: starting the web app"
(cd "$web_dir" && pnpm start >"$web_log" 2>&1 &
 echo $! >"$tmp_dir/web.pid")
web_pid="$(cat "$tmp_dir/web.pid")"
wait_for_http "$web_base/" 60 "the web app"

stamp="$(date +%s)"
object_key="flow_$stamp"
web_object_key="flow_web_$stamp"
# Role names carry the stamp so a rerun never picks up tasks of an earlier run.
approver_role="flow_approver_$stamp"
director_role="flow_director_$stamp"

# ------------------------------------------------------------------ flow 0: sign in ----
# Since ADR 0008 the API needs a session, and the web app keeps it in its own
# httpOnly cookie. This flow bootstraps a designer account and signs in through the
# real form, so everything after it runs as a person.

echo "flows: [0] bootstrapping a designer and signing in through the form"
designer_email="flow_designer_$stamp@example.com"
designer_password="flow-test-password"
department="flow_dept_$stamp"

(cd "$api_dir" && go build -o bin/useradm ./cmd/useradm) || fail "building the useradm CLI failed"
(cd "$api_dir" && ./bin/useradm -create-department -key "$department" -department-name "Flow $stamp") >/dev/null ||
  fail "creating the flow department failed"
# The designer also holds the first approval role, so the inbox flow can be driven
# by the same person who publishes the definition.
(cd "$api_dir" && ./bin/useradm -create -email "$designer_email" -name "Flow designer" \
  -password "$designer_password" -department "$department" \
  -roles "process_designer,$approver_role") >/dev/null ||
  fail "creating the flow designer failed"

sign_in_through_form "$cookie_jar" "$designer_email" "$designer_password" "designer"

status="$(web_get "/" "$tmp_dir/home.html")"
assert_status "$status" "200" "home after signing in"
assert_contains "$tmp_dir/home.html" "Flow designer" "the shell shows who is signed in"

# ------------------------------------------- flow A: schema-driven entry form ----

echo "flows: [A] the record form is generated from the definition"
status="$(web_get "/objects/$object_key" "$tmp_dir/missing.html")"
assert_status "$status" "404" "unknown object page"
assert_contains "$tmp_dir/missing.html" "Business object không tồn tại" "unknown object page"

schema='{"key":"'"$object_key"'","name":"Luồng demo","description":"created by scripts/smoke-demo-flows.sh","fields":[
  {"key":"title","label":"Nội dung","type":"text","required":true},
  {"key":"amount","label":"Số tiền","type":"number","required":true},
  {"key":"due_on","label":"Hạn","type":"date"},
  {"key":"priority","label":"Mức ưu tiên","type":"select","required":true,"options":[
    {"value":"normal","label":"Bình thường"},{"value":"urgent","label":"Gấp"}]},
  {"key":"items","label":"Danh mục","type":"rows"}]}'
status="$(curl -sS -b "$cookie_jar" -o "$tmp_dir/object-created.json" -w '%{http_code}' -X POST \
  "$api_base/api/v1/business-objects" -H 'Content-Type: application/json' -d "$schema")"
assert_status "$status" "201" "creating the flow object through the API"

status="$(web_get "/objects/$object_key" "$tmp_dir/detail.html")"
assert_status "$status" "200" "object detail page"
# React splits interpolated text into separate nodes, so page assertions use
# literals only; version numbers are pinned through the API instead.
assert_contains "$tmp_dir/detail.html" "Field schema — v" "object detail page"
assert_contains "$tmp_dir/detail.html" "phiên bản đang dùng" "object detail page"
for label in 'Nội dung' 'Số tiền' 'Hạn' 'Mức ưu tiên' 'Danh mục'; do
  assert_contains "$tmp_dir/detail.html" "$label" "object detail page (schema table)"
done
assert_contains "$tmp_dir/detail.html" 'name="title"' "object detail page"
assert_contains "$tmp_dir/detail.html" 'name="priority"' "object detail page"
assert_contains "$tmp_dir/detail.html" 'value="urgent"' "object detail page"
assert_contains "$tmp_dir/detail.html" "Chưa có bản ghi nào" "empty records state"

mapfile -t record_args < <(form_args "$tmp_dir/detail.html" objectKey)
[[ ${#record_args[@]} -ge 4 ]] || fail "[A] the record form has no server-action fields"

echo "flows: [A] submitting the form stores a validated record"
status="$(web_post "/objects/$object_key" "$tmp_dir/record-created.html" \
  "${record_args[@]}" \
  --form-string 'title=  Kiểm thử luồng demo  ' \
  --form-string 'amount=1500000' \
  --form-string 'due_on=2026-11-01' \
  --form-string 'priority=urgent' \
  --form-string 'items=Máy in
Mực in')"
assert_status "$status" "200" "record submission"
assert_contains "$tmp_dir/record-created.html" "Đã lưu bản ghi" "record submission"

curl -sS -b "$cookie_jar" -o "$tmp_dir/records.json" "$api_base/api/v1/business-objects/$object_key/records"
python3 - "$tmp_dir/records.json" <<'PY' || fail "[A] the stored record does not match what was submitted"
import json, sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
if len(records) != 1:
    sys.exit(f"expected 1 record, found {len(records)}")
expected = {
    "title": "Kiểm thử luồng demo",
    "amount": 1500000,
    "due_on": "2026-11-01",
    "priority": "urgent",
    "items": ["Máy in", "Mực in"],
}
for key, want in expected.items():
    got = records[0]["values"].get(key)
    if got != want:
        sys.exit(f"values.{key}: expected {want!r}, got {got!r}")
print("flows: stored values verified (trimmed text, number, date, select, rows)")
PY

status="$(web_get "/objects/$object_key" "$tmp_dir/detail-after.html")"
assert_status "$status" "200" "object detail page after the write"
assert_contains "$tmp_dir/detail-after.html" "Kiểm thử luồng demo" "records table"
assert_contains "$tmp_dir/detail-after.html" "Bản ghi đã lưu (" "records table"

# ------------------------------------------- flow B: validation reaches the user ----

echo "flows: [B] rejected input is reported and stores nothing"
status="$(web_post "/objects/$object_key" "$tmp_dir/record-invalid.html" \
  "${record_args[@]}" --form-string 'title=Thiếu số tiền')"
assert_status "$status" "200" "invalid record submission"
assert_contains "$tmp_dir/record-invalid.html" 'role="alert"' "invalid record submission"
assert_contains "$tmp_dir/record-invalid.html" "Dữ liệu chưa hợp lệ" "invalid record submission"

status="$(web_post "/objects/$object_key" "$tmp_dir/record-tampered.html" \
  "${record_args[@]}" \
  --form-string 'title=Option không hợp lệ' \
  --form-string 'amount=1' \
  --form-string 'priority=later')"
assert_status "$status" "200" "tampered option submission"
assert_contains "$tmp_dir/record-tampered.html" 'role="alert"' "tampered option submission"

curl -sS -b "$cookie_jar" -o "$tmp_dir/records-after.json" "$api_base/api/v1/business-objects/$object_key/records"
python3 - "$tmp_dir/records-after.json" <<'PY' || fail "[B] rejected input must not create a record"
import json, sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
if len(records) != 1:
    sys.exit(f"expected the count to stay at 1, found {len(records)}")
print("flows: rejected input created no record")
PY

# ---------------------------------- flow C: admin builder form (schema editor) ----

echo "flows: [C] the object builder submits its schema through the web form"
status="$(web_get "/objects" "$tmp_dir/objects.html")"
assert_status "$status" "200" "objects list page"
mapfile -t create_args < <(form_args "$tmp_dir/objects.html" key fields)
[[ ${#create_args[@]} -ge 4 ]] || fail "[C] the create form has no server-action fields"

builder_schema='[{"key":"asset_name","label":"Tên tài sản","type":"text","required":true},{"key":"state","label":"Tình trạng","type":"select","required":true,"options":[{"value":"in_use","label":"Đang dùng"},{"value":"retired","label":"Đã thanh lý"}]}]'
status="$(web_post "/objects" "$tmp_dir/object-built.html" \
  "${create_args[@]}" \
  --form-string "key=$web_object_key" \
  --form-string 'name=Luồng demo (form)' \
  --form-string 'description=created by scripts/smoke-demo-flows.sh' \
  --form-string "fields=$builder_schema")"
assert_status "$status" "200" "object builder submission"
assert_contains "$tmp_dir/object-built.html" "Đã tạo" "object builder submission"
assert_contains "$tmp_dir/object-built.html" "/objects/$web_object_key" "object builder link"

curl -sS -b "$cookie_jar" -o "$tmp_dir/built-object.json" "$api_base/api/v1/business-objects/$web_object_key"
python3 - "$tmp_dir/built-object.json" <<'PY' || fail "[C] the stored schema does not match the editor"
import json, sys

object_ = json.load(open(sys.argv[1], encoding="utf-8"))
fields = {field["key"]: field for field in object_["fields"]}
if set(fields) != {"asset_name", "state"}:
    sys.exit(f"unexpected fields: {sorted(fields)}")
if not fields["asset_name"].get("required"):
    sys.exit("asset_name should be required")
options = [option["value"] for option in fields["state"].get("options") or []]
if options != ["in_use", "retired"]:
    sys.exit(f"unexpected select options: {options}")
print("flows: the schema editor round-trip is verified (types, required, options)")
PY

status="$(web_post "/objects" "$tmp_dir/object-duplicate.html" \
  "${create_args[@]}" \
  --form-string "key=$web_object_key" \
  --form-string 'name=Trùng key' \
  --form-string "fields=$builder_schema")"
assert_status "$status" "200" "duplicate object submission"
assert_contains "$tmp_dir/object-duplicate.html" "Key này đã tồn tại" "duplicate object submission"

# --------------------------- flow D: metrics and the dashboard layout are real ----

echo "flows: [D] a metric answers real records and the dashboard layout is saved"
metric_key="flow_amount_$stamp"
status="$(curl -sS -b "$cookie_jar" -o "$tmp_dir/metric.json" -w '%{http_code}' -X POST \
  "$api_base/api/v1/metrics" -H 'Content-Type: application/json' \
  -d "$(printf '{"key":"%s","name":"Tổng giá trị luồng demo","objectKey":"%s","aggregation":"sum","field":"amount"}' "$metric_key" "$object_key")")"
assert_status "$status" "201" "creating a metric through the API"

# Flow A stored one record with amount 1.500.000; the metric must answer exactly that.
status="$(curl -sS -b "$cookie_jar" -o "$tmp_dir/metric-result.json" -w '%{http_code}' \
  "$api_base/api/v1/metrics/$metric_key/result")"
assert_status "$status" "200" "reading the metric result"
python3 - "$tmp_dir/metric-result.json" <<'CHECK_METRIC'
import json, sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
if result["total"] != 1500000 or result["records"] != 1:
    sys.exit(f'expected 1500000 over 1 record, got {result["total"]} over {result["records"]}')
print("flows: the metric answered over the projected record values")
CHECK_METRIC

status="$(web_get "/analytics" "$tmp_dir/analytics.html")"
assert_status "$status" "200" "analytics page"
assert_contains "$tmp_dir/analytics.html" "Lưu bố cục" "analytics page"
# The operational read model (ADR 0011) is on the same page and must answer too.
assert_contains "$tmp_dir/analytics.html" "Vận hành quy trình" "the operational section is rendered"
assert_contains "$tmp_dir/analytics.html" "Tỉ lệ duyệt" "the approval rate is shown"
assert_contains "$tmp_dir/analytics.html" "Tỉ lệ phải chạy lại" "the rework rate is shown"
assert_contains "$tmp_dir/analytics.html" "SLA chưa có" "the missing SLA policy is stated, not faked"
assert_contains "$tmp_dir/analytics.html" "Tổng giá trị luồng demo" "the live metric is listed"
assert_contains "$tmp_dir/analytics.html" "1500000" "the metric table shows the real value"

mapfile -t layout_args < <(form_args "$tmp_dir/analytics.html" layout layout)
[[ ${#layout_args[@]} -ge 4 ]] || fail "[D] the layout form has no server-action fields"

custom_layout='[{"id":"w1","metricKey":"'"$metric_key"'","view":"bars","span":2}]'
status="$(web_post "/analytics" "$tmp_dir/layout-saved.html" \
  "${layout_args[@]}" --form-string "layout=$custom_layout")"
assert_status "$status" "200" "layout save"
assert_contains "$tmp_dir/layout-saved.html" "Đã lưu 1 widget" "layout save"

curl -sS -b "$cookie_jar" -o "$tmp_dir/analytics-saved.html" "$web_base/analytics"
assert_contains "$tmp_dir/analytics-saved.html" "Tổng giá trị luồng demo" "saved layout renders the chosen metric"
assert_contains "$tmp_dir/analytics-saved.html" "1.500.000" "the widget shows the real number, formatted"
assert_contains "$tmp_dir/analytics-saved.html" "trên 1 bản ghi bạn được đọc" "the widget says how much data it rests on"
saved_widgets="$(count_occurrences "$tmp_dir/analytics-saved.html" "trên 1 bản ghi bạn được đọc")"
[[ "$saved_widgets" -ge 1 ]] ||
  fail "[D] the saved layout should still render its widget, found $saved_widgets"

# A layout may only reference a metric that exists: writing one that does not is refused
# instead of being stored and silently pruned when it is read back.
status="$(web_post "/analytics" "$tmp_dir/layout-invalid.html" \
  "${layout_args[@]}" --form-string 'layout=[{"id":"w1","metricKey":"khong_ton_tai","view":"kpi","span":1}]')"
assert_status "$status" "200" "invalid layout save"
assert_contains "$tmp_dir/layout-invalid.html" 'role="alert"' "invalid layout save"
assert_contains "$tmp_dir/layout-invalid.html" "không tồn tại" "the refusal names the problem"

echo "flows: [D] a metric created through the web form answers immediately"
web_metric_key="flow_metric_$stamp"
status="$(web_get "/analytics" "$tmp_dir/analytics-form.html")"
assert_status "$status" "200" "analytics page with the create form"
assert_contains "$tmp_dir/analytics-form.html" "Tạo metric" "the create form is offered"
mapfile -t metric_args < <(form_args "$tmp_dir/analytics-form.html" key aggregation)
[[ ${#metric_args[@]} -ge 4 ]] || fail "[D] the metric form has no server-action fields"
status="$(web_post "/analytics" "$tmp_dir/metric-created.html" \
  "${metric_args[@]}" \
  --form-string "key=$web_metric_key" \
  --form-string 'name=Đề nghị trên 1 triệu' \
  --form-string "objectKey=$object_key" \
  --form-string 'aggregation=count' \
  --form-string 'filterField=amount' \
  --form-string 'filterOp=gte' \
  --form-string 'filterValue=1000000')"
assert_status "$status" "200" "creating a metric through the web form"
assert_contains "$tmp_dir/metric-created.html" "Đã tạo metric" "creating a metric through the web form"

curl -sS -b "$cookie_jar" -o "$tmp_dir/web-metric-result.json" \
  "$api_base/api/v1/metrics/$web_metric_key/result"
python3 - "$tmp_dir/web-metric-result.json" <<'CHECK_WEB_METRIC'
import json, sys

result = json.load(open(sys.argv[1], encoding="utf-8"))
metric = result["metric"]
if metric["aggregation"] != "count" or metric["filter"]["field"] != "amount":
    sys.exit(f"the stored metric lost its definition: {metric}")
if result["records"] != 1:
    sys.exit(f'expected the one record above the filter to count, got {result["records"]}')
print("flows: the metric created in the web form filters and counts real records")
CHECK_WEB_METRIC

# A metric the service must refuse: sum over a text field. The message comes from Go.
status="$(web_post "/analytics" "$tmp_dir/metric-invalid.html" \
  "${metric_args[@]}" \
  --form-string "key=${web_metric_key}_bad" \
  --form-string 'name=Sai kiểu' \
  --form-string "objectKey=$object_key" \
  --form-string 'aggregation=sum' \
  --form-string 'field=title')"
assert_status "$status" "200" "invalid metric submission"
assert_contains "$tmp_dir/metric-invalid.html" 'role="alert"' "invalid metric submission"
assert_contains "$tmp_dir/metric-invalid.html" "measures a number field" "the service explains the field type"

# ------------------------------------------------- flow E: the demo surfaces ----

echo "flows: [E] the demo surfaces render with their status labels"
check_surface() {
  local path="$1" label="$2"
  shift 2
  local status
  status="$(web_get "$path" "$tmp_dir/surface.html")"
  assert_status "$status" "200" "$label"
  local needle
  for needle in "$@"; do
    assert_contains "$tmp_dir/surface.html" "$needle" "$label"
  done
}

check_surface "/" "overview" "Walkthrough bản demo" "Trạng thái nền tảng"
check_surface "/forms?object=$object_key" "forms" "Preview form" 'name="priority"'
check_surface "/workflows" "workflows" "Tạo quy trình mới" "Node catalog theo lộ trình"
# No process was started yet, so the live inbox is empty for this role — and it says so.
check_surface "/tasks" "tasks" "Không có việc nào đang chờ bạn" "Engine đã có gì, inbox còn thiếu gì"
check_surface "/apps" "applications" "Kanban" "Cấu hình" "Tích hợp"
check_surface "/roadmap" "roadmap" "Điều kiện nghiệm thu MVP V1" "Quyết định đang mở chặn tiến độ" "Concept"
check_surface "/settings" "settings" "make seed-demo" "make smoke-api"

# The inbox is per person: without a session the screen asks for a sign-in instead
# of rendering anything.
status="$(curl -sS -o "$tmp_dir/tasks-anonymous.html" -w '%{http_code}' "${web_base}/tasks")"
assert_status "$status" "200" "tasks page without a session"
assert_contains "$tmp_dir/tasks-anonymous.html" "Cần đăng nhập để đọc inbox" "tasks page without a session"

# --------------------------------- flow F: publishing a new definition version ----

echo "flows: [F] the schema editor publishes an immutable new version"
status="$(web_get "/objects/$object_key" "$tmp_dir/detail-v1.html")"
assert_status "$status" "200" "object detail page before the edit"
assert_contains "$tmp_dir/detail-v1.html" "phiên bản đang dùng" "version badge before the edit"
assert_contains "$tmp_dir/detail-v1.html" "Lịch sử phiên bản" "version history"

curl -sS -b "$cookie_jar" -o "$tmp_dir/versions-before.json" "$api_base/api/v1/business-objects/$object_key/versions"
python3 - "$tmp_dir/versions-before.json" <<'PY' || fail "[F] the object should start with exactly one published version"
import json, sys

versions = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
if [version["version"] for version in versions] != [1]:
    sys.exit(f"expected only version 1 before the edit, got {[v['version'] for v in versions]}")
print("flows: the object starts at version 1")
PY

# The edit form is the one carrying the schema hidden input on this page; its SSR
# value is excluded because formData.get returns the first value of a name.
mapfile -t edit_args < <(form_args "$tmp_dir/detail-v1.html" fields fields)
[[ ${#edit_args[@]} -ge 4 ]] || fail "[F] the edit form has no server-action fields"

edit_schema='[{"key":"title","label":"Nội dung (v2)","type":"text","required":true},{"key":"amount","label":"Số tiền","type":"number","required":true},{"key":"due_on","label":"Hạn","type":"date"}]'
status="$(web_post "/objects/$object_key" "$tmp_dir/published.html" \
  "${edit_args[@]}" \
  --form-string 'name=Luồng demo (v2)' \
  --form-string 'description=publish bởi scripts/smoke-demo-flows.sh' \
  --form-string "fields=$edit_schema")"
assert_status "$status" "200" "definition publish"
assert_contains "$tmp_dir/published.html" "Đã publish phiên bản v2" "definition publish"

curl -sS -b "$cookie_jar" -o "$tmp_dir/versions.json" "$api_base/api/v1/business-objects/$object_key/versions"
python3 - "$tmp_dir/versions.json" <<'PY' || fail "[F] the published version history is wrong"
import json, sys

versions = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
numbers = [version["version"] for version in versions]
if numbers != [2, 1]:
    sys.exit(f"expected versions [2, 1], got {numbers}")
newest = [field["key"] for field in versions[0]["fields"]]
oldest = [field["key"] for field in versions[-1]["fields"]]
if newest != ["title", "amount", "due_on"] or oldest != ["title", "amount", "due_on", "priority", "items"]:
    sys.exit(f"version schemas are wrong: newest {newest}, oldest {oldest}")
print("flows: version history verified")
PY

status="$(web_get "/objects/$object_key" "$tmp_dir/detail-v2.html")"
assert_status "$status" "200" "object detail page after the edit"
assert_contains "$tmp_dir/detail-v2.html" "phiên bản đang dùng" "version badge after the edit"
assert_contains "$tmp_dir/detail-v2.html" "Nội dung (v2)" "the new schema is rendered"
assert_contains "$tmp_dir/detail-v2.html" "phiên bản cũ — bản ghi giữ nguyên schema" "old records keep their version"
assert_contains "$tmp_dir/detail-v2.html" "Kiểm thử luồng demo" "the v1 record is still listed"

# ------------------------------- flow G: the live inbox and its decisions ----

echo "flows: [G] a started process reaches the inbox and is decided through the forms"

# The escalation approver is a second person, so the handoff between roles is a real
# one: the approver must not be able to decide the director's task, and vice versa.
director_email="flow_director_$stamp@example.com"
director_jar="$tmp_dir/director.cookies"
(cd "$api_dir" && ./bin/useradm -create -email "$director_email" -name "Flow director" \
  -password "$designer_password" -department "$department" -roles "$director_role") >/dev/null ||
  fail "[G] creating the flow director failed"

process_key="flow_approval_$stamp"
process_body="$(printf '{"key":"%s","name":"Luồng duyệt demo","description":"created by scripts/smoke-demo-flows.sh","objectKey":"%s","nodes":[{"key":"start","type":"start","title":"Nhận đề nghị"},{"key":"approve","type":"human_task","title":"Trưởng bộ phận duyệt","assigneeRole":"%s"},{"key":"gate","type":"condition","title":"Trên 1 triệu?","condition":{"field":"amount","op":"gte","value":1000000}},{"key":"escalate","type":"human_task","title":"Giám đốc duyệt","assigneeRole":"%s"},{"key":"end","type":"end","title":"Kết thúc"}],"edges":[{"from":"start","to":"approve"},{"from":"approve","to":"gate"},{"from":"gate","to":"escalate","when":"true"},{"from":"gate","to":"end","when":"false"},{"from":"escalate","to":"end"}]}' \
  "$process_key" "$object_key" "$approver_role" "$director_role")"
status="$(curl -sS -b "$cookie_jar" -o "$tmp_dir/process-created.json" -w '%{http_code}' -X POST \
  "$api_base/api/v1/process-definitions" -H 'Content-Type: application/json' -d "$process_body")"
assert_status "$status" "201" "creating the approval process"

# Start on the record flow A created: amount 1.500.000 sits above the gate, so the
# approval must escalate to the second role.
curl -sS -b "$cookie_jar" -o "$tmp_dir/records.json" "$api_base/api/v1/business-objects/$object_key/records"
record_id="$(python3 - "$tmp_dir/records.json" <<'PY'
import json, sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
match = next((r for r in records if r["values"].get("title") == "Kiểm thử luồng demo"), None)
if match is None:
    sys.exit("flows: the record created in flow A is missing")
print(match["id"])
PY
)"
status="$(curl -sS -b "$cookie_jar" -o "$tmp_dir/instance.json" -w '%{http_code}' -X POST \
  "$api_base/api/v1/process-instances" -H 'Content-Type: application/json' \
  -d "$(printf '{"definitionKey":"%s","recordId":"%s"}' "$process_key" "$record_id")")"
assert_status "$status" "201" "starting the approval process"
instance_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["instance"]["id"])' "$tmp_dir/instance.json")"

echo "flows: [G] the inbox lists the task the engine just created"
status="$(web_get "/tasks" "$tmp_dir/inbox.html")"
assert_status "$status" "200" "tasks page"
assert_contains "$tmp_dir/inbox.html" "Trưởng bộ phận duyệt" "the inbox lists the open task"
assert_contains "$tmp_dir/inbox.html" "Đang chờ bạn" "the inbox summary counts it"
assert_contains "$tmp_dir/inbox.html" "$process_key" "the inbox names the definition"
assert_not_contains "$tmp_dir/inbox.html" "Giám đốc duyệt" "the escalation task does not exist yet"

echo "flows: [G] the instance screen shows the record with its own definition version"
status="$(web_get "/tasks/$instance_id" "$tmp_dir/instance-page.html")"
assert_status "$status" "200" "instance page"
assert_contains "$tmp_dir/instance-page.html" "Kiểm thử luồng demo" "the record is rendered"
assert_contains "$tmp_dir/instance-page.html" "Mức ưu tiên" "the record uses its v1 schema, not the newest"
assert_contains "$tmp_dir/instance-page.html" "Khởi tạo quy trình" "the event log is shown"
assert_contains "$tmp_dir/instance-page.html" "Lý do (bắt buộc khi trả về hoặc từ chối)" "the decision form is offered"

mapfile -t decision_args < <(form_args "$tmp_dir/instance-page.html" decision)
[[ ${#decision_args[@]} -ge 4 ]] || fail "[G] the decision form has no server-action fields"

echo "flows: [G] approving advances the process and evaluates the condition"
status="$(web_post "/tasks/$instance_id" "$tmp_dir/approved.html" \
  "${decision_args[@]}" --form-string 'decision=approve')"
assert_status "$status" "200" "approve decision"
assert_contains "$tmp_dir/approved.html" "Đã duyệt — quy trình chuyển tới node" "the approve is confirmed"
assert_contains "$tmp_dir/approved.html" "việc tiếp theo thuộc role $director_role" "the next role is named"
assert_contains "$tmp_dir/approved.html" "amount gte 1000000" "what the condition saw is in the log"
assert_not_contains "$tmp_dir/approved.html" "Kết thúc quy trình" "the branch not taken did not run"

curl -sS -b "$cookie_jar" -o "$tmp_dir/instance-after.json" "$api_base/api/v1/process-instances/$instance_id"
python3 - "$tmp_dir/instance-after.json" "$director_role" "$designer_email" <<'PY' || fail "[G] the engine did not advance as the screen reported"
import json, sys

view = json.load(open(sys.argv[1], encoding="utf-8"))
director_role, designer_email = sys.argv[2], sys.argv[3]
instance = view["instance"]
if instance["state"] != "running" or instance["currentNode"] != "escalate":
    sys.exit(f'expected running at "escalate", got {instance["state"]} at "{instance["currentNode"]}"')
open_roles = [task["assigneeRole"] for task in view["tasks"] if task["status"] == "open"]
if open_roles != [director_role]:
    sys.exit(f"expected one open task for {director_role}, got {open_roles}")
decided = [task for task in view["tasks"] if task["status"] == "approved"]
if len(decided) != 1 or decided[0]["decidedBy"] != designer_email:
    sys.exit(f"the approval is not attributed to the designer: {decided}")
print("flows: the engine advanced to the escalation role and attributed the approval")
PY

echo "flows: [G] the task belongs to the other person, not to the approver"
status="$(web_get "/tasks/$instance_id" "$tmp_dir/instance-other-role.html")"
assert_status "$status" "200" "instance page as the approver"
assert_contains "$tmp_dir/instance-other-role.html" "bạn không giữ role đó nên không quyết định được" \
  "a role the viewer does not hold is not decidable"
assert_not_contains "$tmp_dir/instance-other-role.html" 'name="decision"' \
  "no decision form is offered for another role"

status="$(web_get "/tasks" "$tmp_dir/inbox-after.html")"
assert_status "$status" "200" "inbox after approving"
assert_contains "$tmp_dir/inbox-after.html" "Không có việc nào đang chờ bạn" \
  "the approver's inbox is empty again"

sign_in_through_form "$director_jar" "$director_email" "$designer_password" "director"
status="$(web_get_as "$director_jar" "/tasks" "$tmp_dir/director-inbox.html")"
assert_status "$status" "200" "director inbox"
assert_contains "$tmp_dir/director-inbox.html" "Giám đốc duyệt" "the escalation task reaches the director"

echo "flows: [G] a return without a reason is rejected by the service"
status="$(web_get_as "$director_jar" "/tasks/$instance_id" "$tmp_dir/director-instance.html")"
assert_status "$status" "200" "instance page as the director"
mapfile -t director_args < <(form_args "$tmp_dir/director-instance.html" decision)
[[ ${#director_args[@]} -ge 4 ]] || fail "[G] the director has no decision form"
status="$(web_post_as "$director_jar" "/tasks/$instance_id" "$tmp_dir/returned-no-reason.html" \
  "${director_args[@]}" --form-string 'decision=return')"
assert_status "$status" "200" "return without a reason"
assert_contains "$tmp_dir/returned-no-reason.html" "Dữ liệu chưa hợp lệ" \
  "the service rejects a return without a reason"

echo "flows: [G] returning resets the process to a new attempt for the first approver"
status="$(web_post_as "$director_jar" "/tasks/$instance_id" "$tmp_dir/returned.html" \
  "${director_args[@]}" --form-string 'decision=return' \
  --form-string 'reason=Bổ sung báo giá của hai nhà cung cấp')"
assert_status "$status" "200" "return decision"
assert_contains "$tmp_dir/returned.html" "Đã trả về người đề nghị — quy trình chạy lại từ đầu với attempt 2" \
  "the return is confirmed with the new attempt"

status="$(web_get "/tasks" "$tmp_dir/inbox-attempt2.html")"
assert_status "$status" "200" "inbox after the return"
assert_contains "$tmp_dir/inbox-attempt2.html" "attempt 2" "the reopened task carries its attempt"

status="$(web_get "/tasks/$instance_id" "$tmp_dir/instance-attempt2.html")"
assert_status "$status" "200" "instance page after the return"
assert_contains "$tmp_dir/instance-attempt2.html" "Bổ sung báo giá của hai nhà cung cấp" \
  "the reason reaches the first approver"
assert_contains "$tmp_dir/instance-attempt2.html" "Reset về điểm bắt đầu" "the reset is in the event log"
assert_contains "$tmp_dir/instance-attempt2.html" 'name="decision"' "the first approver can decide again"

curl -sS -b "$cookie_jar" -o "$tmp_dir/instance-attempt2.json" "$api_base/api/v1/process-instances/$instance_id"
python3 - "$tmp_dir/instance-attempt2.json" "$approver_role" "$director_email" <<'PY' || fail "[G] the returned instance is not in a clean attempt 2"
import json, sys

view = json.load(open(sys.argv[1], encoding="utf-8"))
approver_role, director_email = sys.argv[2], sys.argv[3]
instance = view["instance"]
if instance["state"] != "running" or instance["attempt"] != 2 or instance["currentNode"] != "approve":
    sys.exit(f'expected running at "approve" on attempt 2, got {instance["state"]} at "{instance["currentNode"]}" attempt {instance["attempt"]}')
open_tasks = [(task["nodeKey"], task["assigneeRole"], task["attempt"]) for task in view["tasks"] if task["status"] == "open"]
if open_tasks != [("approve", approver_role, 2)]:
    sys.exit(f"expected one open approver task on attempt 2, got {open_tasks}")
returned = [task for task in view["tasks"] if task["status"] == "returned"]
if len(returned) != 1 or returned[0]["decidedBy"] != director_email or not returned[0].get("reason"):
    sys.exit(f"the return is not recorded with its actor and reason: {returned}")
events = [event["type"] for event in view["events"]]
if events.count("instance_returned") != 1 or events[-1] != "task_created":
    sys.exit(f"unexpected event trail after the reset: {events}")
print("flows: the reset created a clean attempt 2 and kept the audit trail")
PY

# ------------------------- flow H: the designer screen and running from a record ----

echo "flows: [H] a definition is published from the web and run from a record"

web_flow_key="flow_design_$stamp"
status="$(web_get "/workflows" "$tmp_dir/workflows.html")"
assert_status "$status" "200" "workflows page"
assert_contains "$tmp_dir/workflows.html" "Tạo quy trình mới" "workflows page"
assert_contains "$tmp_dir/workflows.html" "$process_key" "the flow created in G is listed"
# The role field suggests the roles that exist (GET /api/v1/roles), so a typo cannot
# silently create a task nobody can decide.
assert_contains "$tmp_dir/workflows.html" "value=\"$approver_role\"" "the role catalogue reaches the editor"

# The create form carries its graph in one hidden input, whose SSR value must be
# excluded: formData.get returns the first value of a name.
mapfile -t create_flow_args < <(form_args "$tmp_dir/workflows.html" graph graph)
[[ ${#create_flow_args[@]} -ge 4 ]] || fail "[H] the create form has no server-action fields"

flow_graph='{"nodes":[{"key":"start","type":"start","title":"Nhận yêu cầu"},{"key":"check","type":"human_task","title":"Kiểm tra yêu cầu","assigneeRole":"'"$approver_role"'"},{"key":"end","type":"end","title":"Kết thúc"}],"edges":[{"from":"start","to":"check"},{"from":"check","to":"end"}]}'
status="$(web_post "/workflows" "$tmp_dir/workflow-created.html" \
  "${create_flow_args[@]}" \
  --form-string "key=$web_flow_key" \
  --form-string 'name=Luồng thiết kế từ web' \
  --form-string "objectKey=$object_key" \
  --form-string "graph=$flow_graph")"
assert_status "$status" "200" "definition create"
assert_contains "$tmp_dir/workflow-created.html" "Đã publish" "definition create"

status="$(web_get "/workflows/$web_flow_key" "$tmp_dir/workflow-detail.html")"
assert_status "$status" "200" "workflow detail page"
assert_contains "$tmp_dir/workflow-detail.html" "Trình soạn $web_flow_key v1" "the editor draws the published graph"
assert_contains "$tmp_dir/workflow-detail.html" "Kiểm tra yêu cầu" "the canvas names the node"
assert_contains "$tmp_dir/workflow-detail.html" "role $approver_role" "the node shows its role"
assert_contains "$tmp_dir/workflow-detail.html" "Trùng bản đã publish" "a fresh editor reports nothing unpublished"
assert_contains "$tmp_dir/workflow-detail.html" "Instance của quy trình này" "the instance section"
assert_contains "$tmp_dir/workflow-detail.html" "Publish phiên bản mới" "the publish button"
assert_contains "$tmp_dir/workflow-detail.html" "Chưa có quy trình nào đang chạy" "no instance yet"

# A definition the service rejects: the graph has no human task, and the message
# comes from the Go service, not from the browser.
bad_graph='{"nodes":[{"key":"start","type":"start","title":"Bắt đầu"},{"key":"end","type":"end","title":"Kết thúc"}],"edges":[{"from":"start","to":"end"}]}'
status="$(web_post "/workflows" "$tmp_dir/workflow-invalid.html" \
  "${create_flow_args[@]}" \
  --form-string "key=${web_flow_key}_bad" \
  --form-string 'name=Luồng sai' \
  --form-string "objectKey=$object_key" \
  --form-string "graph=$bad_graph")"
assert_status "$status" "200" "invalid definition create"
assert_contains "$tmp_dir/workflow-invalid.html" 'role="alert"' "invalid definition create"
assert_contains "$tmp_dir/workflow-invalid.html" "at least one human_task" "the service explains the graph"

echo "flows: [H] a run started from the object page shows up as an instance"
record_id="$(python3 - "$tmp_dir/records.json" <<'PY'
import json, sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
match = next((r for r in records if r["values"].get("title") == "Kiểm thử luồng demo"), None)
if match is None:
    sys.exit("flows: the record created in flow A is missing")
print(match["id"])
PY
)"

# A definition bound to the other object, to prove the run form offers only the
# definitions whose conditions have fields to read on this record.
other_flow_key="flow_other_$stamp"
other_flow_body="$(printf '{"key":"%s","name":"Luồng của object khác","objectKey":"%s","nodes":[{"key":"start","type":"start","title":"Bắt đầu"},{"key":"check","type":"human_task","title":"Kiểm tra tài sản","assigneeRole":"%s"},{"key":"end","type":"end","title":"Kết thúc"}],"edges":[{"from":"start","to":"check"},{"from":"check","to":"end"}]}' "$other_flow_key" "$web_object_key" "$approver_role")"
status="$(curl -sS -b "$cookie_jar" -o "$tmp_dir/other-flow.json" -w '%{http_code}' -X POST \
  "$api_base/api/v1/process-definitions" -H 'Content-Type: application/json' -d "$other_flow_body")"
assert_status "$status" "201" "creating a definition for the other object"

status="$(web_get "/objects/$object_key" "$tmp_dir/object-run.html")"
assert_status "$status" "200" "object page with the run form"
assert_contains "$tmp_dir/object-run.html" "Chạy quy trình" "the run form is offered"
assert_contains "$tmp_dir/object-run.html" "$web_flow_key" "definitions of this object are offered"
assert_not_contains "$tmp_dir/object-run.html" "$other_flow_key" "a definition of another object is not offered"

mapfile -t start_args < <(form_args "$tmp_dir/object-run.html" definitionKey)
[[ ${#start_args[@]} -ge 4 ]] || fail "[H] the run form has no server-action fields"
status="$(web_post "/objects/$object_key" "$tmp_dir/instance-started.html" \
  "${start_args[@]}" \
  --form-string "definitionKey=$web_flow_key" \
  --form-string "recordId=$record_id")"
assert_status "$status" "200" "starting a run from the web"
assert_contains "$tmp_dir/instance-started.html" "Đã chạy" "starting a run from the web"
assert_contains "$tmp_dir/instance-started.html" "việc đầu tiên thuộc role $approver_role" "the run names the first role"

status="$(web_get "/objects/$object_key" "$tmp_dir/object-instances.html")"
assert_status "$status" "200" "object page after the run"
assert_contains "$tmp_dir/object-instances.html" "Quy trình trên các bản ghi này" "the instance section"
assert_contains "$tmp_dir/object-instances.html" "Kiểm thử luồng demo" "the instance row names its record"
assert_contains "$tmp_dir/object-instances.html" "v1 · attempt 1" "the instance is listed with its version"
assert_contains "$tmp_dir/object-instances.html" "Kiểm tra yêu cầu" "the list names the waiting task"

status="$(web_get "/workflows/$web_flow_key" "$tmp_dir/workflow-instances.html")"
assert_status "$status" "200" "workflow detail after the run"
assert_contains "$tmp_dir/workflow-instances.html" "Kiểm tra yêu cầu" "the definition lists its instance"

status="$(web_get "/tasks" "$tmp_dir/inbox-run.html")"
assert_status "$status" "200" "inbox after the run"
assert_contains "$tmp_dir/inbox-run.html" "Kiểm tra yêu cầu" "the new task reaches the approver's inbox"

echo "flows: [H] a definition naming a role nobody holds is flagged"
ghost_role="flow_ghost_$stamp"
ghost_key="flow_ghost_flow_$stamp"
ghost_body="$(printf '{"key":"%s","name":"Luồng thiếu người nhận","objectKey":"%s","nodes":[{"key":"start","type":"start","title":"Bắt đầu"},{"key":"check","type":"human_task","title":"Việc của role không tồn tại","assigneeRole":"%s"},{"key":"end","type":"end","title":"Kết thúc"}],"edges":[{"from":"start","to":"check"},{"from":"check","to":"end"}]}' "$ghost_key" "$object_key" "$ghost_role")"
status="$(curl -sS -b "$cookie_jar" -o "$tmp_dir/ghost-flow.json" -w '%{http_code}' -X POST \
  "$api_base/api/v1/process-definitions" -H 'Content-Type: application/json' -d "$ghost_body")"
assert_status "$status" "201" "creating a definition with an unheld role"

# The graph is valid, so publishing it succeeds; the screen is what warns, because an
# instance would stop at that node and appear in nobody's inbox.
status="$(web_get "/workflows/$ghost_key" "$tmp_dir/ghost-detail.html")"
assert_status "$status" "200" "detail page of the definition with an unheld role"
assert_contains "$tmp_dir/ghost-detail.html" "Role chưa có ai giữ" "the unheld role is flagged"
assert_contains "$tmp_dir/ghost-detail.html" "$ghost_role" "the warning names the role"
assert_contains "$tmp_dir/ghost-detail.html" "-add-role" "the warning says how to fix it"

echo "flows: [H] a draft stays in the browser and never reaches the engine"
curl -sS -b "$cookie_jar" -o "$tmp_dir/definition-before-draft.json" \
  "$api_base/api/v1/process-definitions/$web_flow_key"
# The save-draft form is on the page fetched at the start of this flow (the editor is the
# same before and after a publish).
mapfile -t draft_args < <(form_args "$tmp_dir/workflow-detail.html" draft draft)
[[ ${#draft_args[@]} -ge 4 ]] || fail "[H] the draft form has no server-action fields"
draft_payload='{"nodes":[{"key":"start","type":"start","title":"Nhận yêu cầu","x":24,"y":24},{"key":"check","type":"human_task","title":"Kiểm tra yêu cầu (v2)","assigneeRole":"'"$approver_role"'","x":238,"y":24},{"key":"extra","type":"human_task","title":"Bước nháp chưa publish","assigneeRole":"'"$approver_role"'","x":452,"y":24},{"key":"end","type":"end","title":"Kết thúc","x":666,"y":24}],"edges":[{"id":"e1","from":"start","to":"check"},{"id":"e2","from":"check","to":"extra"},{"id":"e3","from":"extra","to":"end"}]}'
status="$(web_post "/workflows/$web_flow_key" "$tmp_dir/draft-saved.html" \
  "${draft_args[@]}" --form-string "draft=$draft_payload")"
assert_status "$status" "200" "saving a draft"
assert_contains "$tmp_dir/draft-saved.html" "Đã lưu bản nháp" "saving a draft"

status="$(web_get "/workflows/$web_flow_key" "$tmp_dir/draft-loaded.html")"
assert_status "$status" "200" "the editor with a saved draft"
assert_contains "$tmp_dir/draft-loaded.html" "Bản nháp khác bản đã publish" "the editor reports the draft"
assert_contains "$tmp_dir/draft-loaded.html" "Bước nháp chưa publish" "the draft's own node is on the canvas"
assert_contains "$tmp_dir/draft-loaded.html" "có bản nháp đã lưu cho trình duyệt này" "the editor says a draft is stored"

# The engine must not know about the draft: the published definition is still v2 with its
# three nodes, which is the whole point of keeping drafts out of the runtime (ADR 0013).
curl -sS -b "$cookie_jar" -o "$tmp_dir/definition-with-draft.json" \
  "$api_base/api/v1/process-definitions/$web_flow_key"
python3 - "$tmp_dir/definition-before-draft.json" "$tmp_dir/definition-with-draft.json" <<'CHECK_DRAFT_ISOLATED'
import json, sys

before = json.load(open(sys.argv[1], encoding="utf-8"))
after = json.load(open(sys.argv[2], encoding="utf-8"))
if before != after:
    sys.exit(f"the published definition changed while a draft existed: {before} -> {after}")
if "extra" in [node["key"] for node in after["nodes"]]:
    sys.exit("a draft node reached the published definition")
print(f"flows: the published definition (v{after['version']}) is untouched while a draft exists")
CHECK_DRAFT_ISOLATED

status="$(web_post "/workflows/$web_flow_key" "$tmp_dir/draft-discarded.html" \
  "${draft_args[@]}" --form-string 'draft=discard')"
assert_status "$status" "200" "discarding a draft"
assert_contains "$tmp_dir/draft-discarded.html" "Đã bỏ bản nháp" "discarding a draft"

status="$(web_get "/workflows/$web_flow_key" "$tmp_dir/draft-gone.html")"
assert_contains "$tmp_dir/draft-gone.html" "Trùng bản đã publish" "discarding returns to the published graph"
assert_not_contains "$tmp_dir/draft-gone.html" "Bước nháp chưa publish" "the discarded node is gone"

echo "flows: [H] publishing v2 leaves the running instance on v1"
mapfile -t publish_args < <(form_args "$tmp_dir/workflow-instances.html" graph graph)
[[ ${#publish_args[@]} -ge 4 ]] || fail "[H] the publish form has no server-action fields"
flow_graph_v2='{"nodes":[{"key":"start","type":"start","title":"Nhận yêu cầu"},{"key":"check","type":"human_task","title":"Kiểm tra yêu cầu (v2)","assigneeRole":"'"$approver_role"'"},{"key":"end","type":"end","title":"Kết thúc"}],"edges":[{"from":"start","to":"check"},{"from":"check","to":"end"}]}'
status="$(web_post "/workflows/$web_flow_key" "$tmp_dir/workflow-published.html" \
  "${publish_args[@]}" \
  --form-string 'name=Luồng thiết kế từ web (v2)' \
  --form-string "graph=$flow_graph_v2")"
assert_status "$status" "200" "definition publish"
assert_contains "$tmp_dir/workflow-published.html" "Đã publish phiên bản v2" "definition publish"

status="$(web_get "/workflows/$web_flow_key" "$tmp_dir/workflow-v2.html")"
assert_status "$status" "200" "workflow detail after the publish"
assert_contains "$tmp_dir/workflow-v2.html" "phiên bản đang dùng v2" "the newest version is in use"
assert_contains "$tmp_dir/workflow-v2.html" "Kiểm tra yêu cầu (v2)" "the canvas shows the new graph"
# The instance keeps the version it started with: this is ADR 0006 in the UI.
assert_contains "$tmp_dir/workflow-v2.html" "v1 · attempt 1" "the running instance stays on v1"
curl -sS -b "$cookie_jar" -o "$tmp_dir/instances.json" "$api_base/api/v1/process-instances?definitionKey=$web_flow_key"
python3 - "$tmp_dir/instances.json" "$web_flow_key" <<'PY' || fail "[H] the instance list does not match the UI"
import json, sys

summaries = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
if len(summaries) != 1:
    sys.exit(f"expected one instance of {sys.argv[2]}, got {len(summaries)}")
instance = summaries[0]["instance"]
if instance["definitionVersion"] != 1 or instance["state"] != "running":
    sys.exit(f'expected a running instance on v1, got v{instance["definitionVersion"]} {instance["state"]}')
open_roles = [task["assigneeRole"] for task in summaries[0]["openTasks"]]
if len(open_roles) != 1:
    sys.exit(f"expected one open task in the list row, got {open_roles}")
print("flows: the instance list carries the version, the state and the waiting role")
PY

echo "flows: PASS"
