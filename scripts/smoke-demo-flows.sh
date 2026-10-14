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

# count_occurrences <file> <text> -> prints how many times a literal appears
count_occurrences() {
  grep -oF -- "$2" "$1" | wc -l | tr -d ' '
}

# web_get <path> <outfile> -> status code
web_get() {
  curl -sS -o "$2" -w '%{http_code}' "${web_base}$1"
}

# web_post <path> <outfile> [--form-string ...] -> status code; keeps cookies so
# the dashboard-layout flow can prove the cookie round-trip.
web_post() {
  local path="$1" out="$2"
  shift 2
  curl -sS -o "$out" -w '%{http_code}' -X POST "${web_base}${path}" \
    -H "Origin: $web_base" -c "$cookie_jar" -b "$cookie_jar" "$@"
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
status="$(curl -sS -o "$tmp_dir/object-created.json" -w '%{http_code}' -X POST \
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

curl -sS -o "$tmp_dir/records.json" "$api_base/api/v1/business-objects/$object_key/records"
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

curl -sS -o "$tmp_dir/records-after.json" "$api_base/api/v1/business-objects/$object_key/records"
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

curl -sS -o "$tmp_dir/built-object.json" "$api_base/api/v1/business-objects/$web_object_key"
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

# ------------------------------------- flow D: dashboard layout is saved for real ----

echo "flows: [D] the dashboard layout is saved and read back"
status="$(web_get "/analytics" "$tmp_dir/analytics.html")"
assert_status "$status" "200" "analytics page"
assert_contains "$tmp_dir/analytics.html" "Lưu bố cục" "analytics page"
default_widgets="$(count_occurrences "$tmp_dir/analytics.html" "Hiển thị")"
[[ "$default_widgets" -gt 1 ]] ||
  fail "[D] the default dashboard should render several widgets, found $default_widgets"

mapfile -t layout_args < <(form_args "$tmp_dir/analytics.html" layout layout)
[[ ${#layout_args[@]} -ge 4 ]] || fail "[D] the layout form has no server-action fields"

custom_layout='[{"id":"w1","kind":"kpi","metricId":"rework_rate","dimension":"process","span":2,"chartKind":"line"}]'
status="$(web_post "/analytics" "$tmp_dir/layout-saved.html" \
  "${layout_args[@]}" --form-string "layout=$custom_layout")"
assert_status "$status" "200" "layout save"
assert_contains "$tmp_dir/layout-saved.html" "Đã lưu 1 widget" "layout save"

curl -sS -b "$cookie_jar" -o "$tmp_dir/analytics-saved.html" "$web_base/analytics"
assert_contains "$tmp_dir/analytics-saved.html" "Rework rate" "saved layout renders the chosen metric"
saved_widgets="$(count_occurrences "$tmp_dir/analytics-saved.html" "Hiển thị")"
[[ "$saved_widgets" == "1" ]] ||
  fail "[D] the saved layout should render 1 widget, found $saved_widgets"

status="$(web_post "/analytics" "$tmp_dir/layout-invalid.html" \
  "${layout_args[@]}" --form-string 'layout=[{"id":"w1"}]')"
assert_status "$status" "200" "invalid layout save"
assert_contains "$tmp_dir/layout-invalid.html" 'role="alert"' "invalid layout save"

curl -sS -b "$cookie_jar" -o "$tmp_dir/analytics-kept.html" "$web_base/analytics"
kept_widgets="$(count_occurrences "$tmp_dir/analytics-kept.html" "Hiển thị")"
[[ "$kept_widgets" == "1" ]] ||
  fail "[D] a rejected save must not overwrite the stored layout (found $kept_widgets widgets)"
assert_contains "$tmp_dir/analytics-kept.html" "Rework rate" "a rejected save must keep the layout"

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
check_surface "/workflows" "workflows" "Màn hình còn dùng fixture — runtime đã có ở API" "Trưởng bộ phận duyệt"
check_surface "/tasks" "tasks" "PR-2026-014" "Đang chờ bạn" "engine đã chạy thật ở API"
check_surface "/apps" "applications" "Kanban" "Cấu hình" "Tích hợp"
check_surface "/roadmap" "roadmap" "Điều kiện nghiệm thu MVP V1" "Quyết định đang mở chặn tiến độ" "Concept"
check_surface "/settings" "settings" "make seed-demo" "make smoke-api"

# --------------------------------- flow F: publishing a new definition version ----

echo "flows: [F] the schema editor publishes an immutable new version"
status="$(web_get "/objects/$object_key" "$tmp_dir/detail-v1.html")"
assert_status "$status" "200" "object detail page before the edit"
assert_contains "$tmp_dir/detail-v1.html" "phiên bản đang dùng" "version badge before the edit"
assert_contains "$tmp_dir/detail-v1.html" "Lịch sử phiên bản" "version history"

curl -sS -o "$tmp_dir/versions-before.json" "$api_base/api/v1/business-objects/$object_key/versions"
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

curl -sS -o "$tmp_dir/versions.json" "$api_base/api/v1/business-objects/$object_key/versions"
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

echo "flows: PASS"
