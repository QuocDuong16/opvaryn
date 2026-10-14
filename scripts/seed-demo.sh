#!/usr/bin/env bash
#
# Seeds the demo dataset through the public API, so the data has exactly the shape
# a user would create by hand. The three pilot processes D07 names are seeded:
# purchase requests, IT incidents, and HR onboarding.
#
# Since ADR 0008 the API needs a session and records carry the department of the
# session that created them, so this script bootstraps one account per department
# and creates each record as that department. That is what makes the department
# scoping visible in the demo instead of theoretical.
#
# Idempotent: departments and users are created only when missing, objects and
# process definitions only when their key is missing, and records only while the
# object has none. The pilot processes are started only when the role that should
# hold the next task has no open task for that definition, so re-running the seed
# does not pile up instances — but it is a demo seeder, not a data synchroniser.
#
# Requires: the API running against migrated PostgreSQL (make docker-up,
# cd apps/api && go run ./cmd/migrate, make dev-api).
#
# Usage: bash scripts/seed-demo.sh   (or: make seed-demo)
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_dir="$root_dir/apps/api"
base_url="${API_BASE_URL:-http://localhost:21501}"
body_file="$(mktemp -t opvaryn-seed-body.XXXXXX)"
jar_dir="$(mktemp -d -t opvaryn-seed-jars.XXXXXX)"
trap 'rm -f "$body_file"; rm -rf "$jar_dir"' EXIT
skipped=0

# The local demo password. It is not a secret: it is printed by the guide and only
# ever used against a local database.
demo_password="demo-password-opvaryn"

fail() {
  echo "seed: FAIL: $*" >&2
  exit 1
}

# request <jar|-> <method> <path> [json-body] -> writes body to $body_file, prints status
request() {
  local jar="$1" method="$2" path="$3" json="${4:-}"
  local cookie_args=()
  if [[ "$jar" != "-" ]]; then
    cookie_args=(-b "$jar" -c "$jar")
  fi
  if [[ -n "$json" ]]; then
    curl -sS -o "$body_file" -w '%{http_code}' -X "$method" "$base_url$path" \
      "${cookie_args[@]}" -H 'Content-Type: application/json' -d "$json"
  else
    curl -sS -o "$body_file" -w '%{http_code}' -X "$method" "$base_url$path" "${cookie_args[@]}"
  fi
}

# field_keys <json-body>: prints the field keys of a definition body or response.
field_keys() {
  python3 -c 'import json,sys; print(" ".join(f["key"] for f in json.loads(sys.argv[1]).get("fields") or []))' "$1"
}

curl -sf "$base_url/readyz" >/dev/null ||
  fail "API chưa sẵn sàng tại $base_url — chạy 'make docker-up', migrate rồi 'make dev-api' trước."

useradm() { (cd "$api_dir" && go run ./cmd/useradm "$@"); }

# ensure_department <key> <name>
ensure_department() {
  useradm -create-department -key "$1" -department-name "$2" >/dev/null ||
    fail "không tạo được bộ phận '$1'"
}

# ensure_user <email> <name> <department> <roles>
ensure_user() {
  local email="$1" name="$2" department="$3" roles="$4"
  if useradm -create -email "$email" -name "$name" -password "$demo_password" \
      -department "$department" -roles "$roles" >/dev/null 2>&1; then
    echo "seed: đã tạo tài khoản $email ($department)."
    return
  fi
  # Already there: make sure it holds the roles this seed needs.
  useradm -add-role -email "$email" -roles "$roles" >/dev/null ||
    fail "không gán được role cho $email"
}

# login <jar> <email> -> 0 when a session was opened
login() {
  local status
  status="$(request "$1" POST /api/v1/auth/login \
    "$(printf '{"email":"%s","password":"%s"}' "$2" "$demo_password")")"
  [[ "$status" == "200" ]]
}

# jar_for <email> -> path of a cookie jar signed in as that account
jar_for() {
  local email="$1"
  local slug="${email//[@.]/_}"
  local jar="$jar_dir/$slug.cookies"
  if [[ ! -f "$jar" ]]; then
    login "$jar" "$email" ||
      fail "không đăng nhập được tài khoản '$email'"
  fi
  printf '%s' "$jar"
}

# ensure_process_definition <jar> <key> <json-body>: publish version 1 only when missing.
ensure_process_definition() {
  local jar="$1" key="$2" body="$3" status
  status="$(request "$jar" GET "/api/v1/process-definitions/$key")"
  case "$status" in
    200) echo "seed: quy trình '$key' đã tồn tại, bỏ qua." ;;
    404)
      status="$(request "$jar" POST /api/v1/process-definitions "$body")"
      [[ "$status" == "201" ]] || fail "tạo quy trình '$key' trả về $status, mong đợi 201."
      echo "seed: đã publish quy trình '$key' (v1)."
      ;;
    *) fail "GET process definition '$key' trả về $status." ;;
  esac
}

# inbox_has_task <jar> <definition-key> -> 0 when that person already has an open
# task of the process. This is how the seeder decides whether a pilot flow still
# needs an instance in flight, without a "list instances" endpoint.
inbox_has_task() {
  local status
  status="$(request "$1" GET /api/v1/tasks)"
  [[ "$status" == "200" ]] || fail "GET /api/v1/tasks trả về $status."
  grep -q "\"definitionKey\":\"$2\"" "$body_file"
}

# record_id_for <jar> <object-key> <field-key> <value> -> id of the matching record
record_id_for() {
  local status
  status="$(request "$1" GET "/api/v1/business-objects/$2/records")"
  [[ "$status" == "200" ]] || fail "GET records của '$2' trả về $status."
  python3 - "$body_file" "$3" "$4" <<'PY'
import json, sys

records = json.load(open(sys.argv[1], encoding="utf-8"))["data"]
field, value = sys.argv[2], sys.argv[3]
match = next((record for record in records if record["values"].get(field) == value), None)
if match is None:
    sys.exit(f"seed: không tìm thấy bản ghi có {field}={value!r}")
print(match["id"])
PY
}

# start_instance <jar> <definition-key> <record-id> -> prints the new instance id
start_instance() {
  local status
  status="$(request "$1" POST /api/v1/process-instances \
    "$(printf '{"definitionKey":"%s","recordId":"%s"}' "$2" "$3")")"
  [[ "$status" == "201" ]] || fail "start instance cho '$2' trả về $status, mong đợi 201."
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["instance"]["id"])' "$body_file"
}

# open_task_id <jar> <instance-id> <node-key> -> prints the open task of that node
open_task_id() {
  local status
  status="$(request "$1" GET "/api/v1/process-instances/$2")"
  [[ "$status" == "200" ]] || fail "GET instance '$2' trả về $status."
  python3 - "$body_file" "$3" <<'PY'
import json, sys

view = json.load(open(sys.argv[1], encoding="utf-8"))
node = sys.argv[2]
tasks = [task for task in view["tasks"] if task["status"] == "open" and task["nodeKey"] == node]
if not tasks:
    sys.exit(f"seed: instance không có task mở ở node {node!r}")
print(tasks[0]["id"])
PY
}

# decide_task <jar> <instance-id> <task-id> <decision> [reason]
decide_task() {
  local status
  if [[ -n "${5:-}" ]]; then
    status="$(request "$1" POST "/api/v1/process-instances/$2/tasks/$3/decisions" \
      "$(printf '{"decision":"%s","reason":"%s"}' "$4" "$5")")"
  else
    status="$(request "$1" POST "/api/v1/process-instances/$2/tasks/$3/decisions" \
      "$(printf '{"decision":"%s"}' "$4")")"
  fi
  [[ "$status" == "200" ]] || fail "quyết định '$4' cho task '$3' trả về $status, mong đợi 200."
}

# ensure_object <jar> <key> <json-body>: create the definition only when it is missing.
ensure_object() {
  local jar="$1" key="$2" body="$3" status
  status="$(request "$jar" GET "/api/v1/business-objects/$key")"
  case "$status" in
    200) echo "seed: business object '$key' đã tồn tại, bỏ qua." ;;
    404)
      status="$(request "$jar" POST /api/v1/business-objects "$body")"
      [[ "$status" == "201" ]] || fail "tạo business object '$key' trả về $status, mong đợi 201."
      echo "seed: đã tạo business object '$key'."
      ;;
    *) fail "GET business object '$key' trả về $status." ;;
  esac
}

# ensure_records_match_schema <jar> <key> <json-body>: warn (and skip) when the stored
# definition does not declare every field the demo records use.
ensure_records_match_schema() {
  local jar="$1" key="$2" body="$3" status actual expected field
  status="$(request "$jar" GET "/api/v1/business-objects/$key")"
  [[ "$status" == "200" ]] || fail "GET business object '$key' trả về $status."

  actual="$(field_keys "$(cat "$body_file")")"
  expected="$(field_keys "$body")"

  for field in $expected; do
    if [[ " $actual " != *" $field "* ]]; then
      echo "seed: CẢNH BÁO: '$key' đã tồn tại với schema khác (thiếu field '$field')." >&2
      echo "seed: schema hiện có: ${actual:-<trống>}" >&2
      echo "seed: bỏ qua bản ghi cho '$key'. Sửa schema chưa thuộc demo — chạy 'make docker-clean'" >&2
      echo "seed: rồi migrate lại nếu muốn nạp đủ bộ dữ liệu mẫu." >&2
      skipped=1
      return 1
    fi
  done
  return 0
}

# seed_records <admin-jar> <key> <json-body> <department:values-json>...
# Each record is created by a user of its own department, which is what gives the
# record its scope (ADR 0008).
seed_records() {
  local admin_jar="$1" key="$2" body="$3"
  shift 3
  local status entry department values jar

  if ! ensure_records_match_schema "$admin_jar" "$key" "$body"; then
    return 0
  fi

  status="$(request "$admin_jar" GET "/api/v1/business-objects/$key/records")"
  [[ "$status" == "200" ]] || fail "GET records của '$key' trả về $status."

  if ! grep -q '"data":\[\]' "$body_file"; then
    echo "seed: '$key' đã có bản ghi, bỏ qua."
    return 0
  fi

  for entry in "$@"; do
    department="${entry%%:*}"
    values="${entry#*:}"
    jar="$(jar_for "seed_$department@opvaryn.local")"
    status="$(request "$jar" POST "/api/v1/business-objects/$key/records" "{\"values\":$values}")"
    [[ "$status" == "201" ]] || fail "tạo bản ghi cho '$key' ở bộ phận '$department' trả về $status, mong đợi 201."
  done
  echo "seed: đã thêm bản ghi demo cho '$key' (theo từng bộ phận)."
}

echo "seed: chuẩn bị bộ phận và tài khoản demo"
ensure_department ky_thuat "Kỹ thuật"
ensure_department kinh_doanh "Kinh doanh"
ensure_department van_hanh "Vận hành"
ensure_department marketing "Marketing"
ensure_department ke_toan "Kế toán"
ensure_department ban_giam_doc "Ban giám đốc"
ensure_department nhan_su "Nhân sự"
ensure_user seed@opvaryn.local "Tài khoản seed" ban_giam_doc "admin"
for department in ky_thuat kinh_doanh van_hanh marketing; do
  ensure_user "seed_$department@opvaryn.local" "Seed $department" "$department" "nhan_vien"
done

# Accounts that hold the roles the pilot processes assign. Without them an instance
# would wait forever on a role nobody has, which would make the pilot data useless.
ensure_user seed_truong_ky_thuat@opvaryn.local "Trưởng bộ phận Kỹ thuật" ky_thuat "nhan_vien,truong_bo_phan"
ensure_user seed_ke_toan@opvaryn.local "Kế toán" ke_toan "ke_toan"
ensure_user seed_giam_doc@opvaryn.local "Giám đốc" ban_giam_doc "giam_doc"
ensure_user seed_it@opvaryn.local "IT support" ky_thuat "it_support"
# HR opens the onboarding records, so this account is also the department account
# the record seeder signs in with.
ensure_user seed_nhan_su@opvaryn.local "Nhân sự" nhan_su "nhan_vien,nhan_su"

admin_jar="$(jar_for seed@opvaryn.local)"

purchase_body='{
  "key": "purchase_request",
  "name": "Đề nghị mua hàng",
  "description": "Nhân viên đề nghị mua thiết bị hoặc dịch vụ; trưởng bộ phận và kế toán duyệt theo ngưỡng giá trị.",
  "fields": [
    {"key": "title", "label": "Nội dung đề nghị", "type": "text", "required": true},
    {"key": "requester", "label": "Người đề nghị", "type": "text"},
    {"key": "department", "label": "Bộ phận", "type": "select", "required": true, "options": [
      {"value": "kinh_doanh", "label": "Kinh doanh"},
      {"value": "ky_thuat", "label": "Kỹ thuật"},
      {"value": "van_hanh", "label": "Vận hành"},
      {"value": "marketing", "label": "Marketing"}
    ]},
    {"key": "estimated_amount", "label": "Giá trị dự kiến (VND)", "type": "number", "required": true},
    {"key": "needed_by", "label": "Cần trước ngày", "type": "date"},
    {"key": "justification", "label": "Lý do", "type": "text"},
    {"key": "items", "label": "Danh mục", "type": "rows"}
  ]
}'

incident_body='{
  "key": "it_incident",
  "name": "Sự cố IT",
  "description": "Người dùng hoặc hệ thống giám sát báo sự cố; phân loại theo mức độ và hệ thống bị ảnh hưởng.",
  "fields": [
    {"key": "summary", "label": "Mô tả sự cố", "type": "text", "required": true},
    {"key": "reporter", "label": "Người báo", "type": "text"},
    {"key": "severity", "label": "Mức độ", "type": "select", "required": true, "options": [
      {"value": "thap", "label": "Thấp"},
      {"value": "trung_binh", "label": "Trung bình"},
      {"value": "cao", "label": "Cao"},
      {"value": "nghiem_trong", "label": "Nghiêm trọng"}
    ]},
    {"key": "system", "label": "Hệ thống", "type": "select", "required": true, "options": [
      {"value": "erp", "label": "ERP"},
      {"value": "email", "label": "Email"},
      {"value": "vpn", "label": "VPN"},
      {"value": "laptop", "label": "Thiết bị đầu cuối"}
    ]},
    {"key": "opened_at", "label": "Ngày ghi nhận", "type": "date"},
    {"key": "impact", "label": "Ảnh hưởng", "type": "text"}
  ]
}'

ensure_object "$admin_jar" purchase_request "$purchase_body"
seed_records "$admin_jar" purchase_request "$purchase_body" \
  'ky_thuat:{"title":"MacBook Pro 14 inch cho nhân viên mới","requester":"Trần Minh Anh","department":"ky_thuat","estimated_amount":52900000,"needed_by":"2026-11-01","justification":"Thay máy đã hết bảo hành, phục vụ dự án OPVARYN.","items":["MacBook Pro 14 M5 24GB","AppleCare+ 3 năm"]}' \
  'ky_thuat:{"title":"Màn hình Dell UltraSharp 27 inch","requester":"Lê Hoàng","department":"ky_thuat","estimated_amount":9800000,"needed_by":"2026-10-25","items":["Dell U2723QE"]}' \
  'van_hanh:{"title":"Bàn phím cơ và chuột ergonomic","requester":"Phạm Thu Hà","department":"van_hanh","estimated_amount":3200000,"needed_by":"2026-10-30","justification":"Bổ sung thiết bị cho bàn làm việc mới.","items":["Keychron K8 Pro","Logitech MX Master 3S"]}' \
  'marketing:{"title":"Gói dịch vụ thiết kế landing page","requester":"Nguyễn Quốc Bảo","department":"marketing","estimated_amount":24500000,"needed_by":"2026-11-15","justification":"Chiến dịch ra mắt quý 4."}' \
  'kinh_doanh:{"title":"Ghế công thái học cho phòng họp","requester":"Đỗ Thanh Mai","department":"kinh_doanh","estimated_amount":15000000,"needed_by":"2026-12-01","items":["Ghế ergonomic x3"]}'

ensure_object "$admin_jar" it_incident "$incident_body"
seed_records "$admin_jar" it_incident "$incident_body" \
  'ky_thuat:{"summary":"Không đăng nhập được VPN sau khi đổi mật khẩu","reporter":"Vũ Nhật Linh","severity":"cao","system":"vpn","opened_at":"2026-10-09","impact":"3 nhân viên không truy cập được hệ thống nội bộ."}' \
  'ky_thuat:{"summary":"Đồng bộ tồn kho ERP lệch so với thực tế","reporter":"Bùi Anh Tuấn","severity":"nghiem_trong","system":"erp","opened_at":"2026-10-08","impact":"Báo cáo tồn kho sai lệch ở 2 mã hàng."}' \
  'van_hanh:{"summary":"Hộp thư dùng chung không nhận được email từ đối tác","reporter":"Nguyễn Thảo Vy","severity":"trung_binh","system":"email","opened_at":"2026-10-10","impact":"Chậm phản hồi yêu cầu mua hàng."}' \
  'marketing:{"summary":"Laptop khởi động chậm sau bản cập nhật","reporter":"Hoàng Minh Đức","severity":"thap","system":"laptop","opened_at":"2026-10-11","impact":"Thời gian khởi động khoảng 4 phút."}'

hr_body='{
  "key": "hr_onboarding",
  "name": "Onboarding nhân sự",
  "description": "HR mở hồ sơ cho người mới; IT cấp tài khoản và thiết bị; quản lý trực tiếp xác nhận đã nhận việc.",
  "fields": [
    {"key": "employee_name", "label": "Họ tên nhân viên", "type": "text", "required": true},
    {"key": "position", "label": "Vị trí", "type": "text", "required": true},
    {"key": "department", "label": "Bộ phận", "type": "select", "required": true, "options": [
      {"value": "ky_thuat", "label": "Kỹ thuật"},
      {"value": "kinh_doanh", "label": "Kinh doanh"},
      {"value": "van_hanh", "label": "Vận hành"},
      {"value": "marketing", "label": "Marketing"},
      {"value": "nhan_su", "label": "Nhân sự"}
    ]},
    {"key": "start_date", "label": "Ngày bắt đầu", "type": "date", "required": true},
    {"key": "equipment", "label": "Thiết bị cần cấp", "type": "select", "options": [
      {"value": "laptop", "label": "Laptop"},
      {"value": "laptop_phone", "label": "Laptop và điện thoại"},
      {"value": "none", "label": "Không cần"}
    ]},
    {"key": "notes", "label": "Ghi chú bàn giao", "type": "text"}
  ]
}'

# HR opens the file, so these records carry the HR department even when the new hire
# joins another one — that is what "bộ phận của bản ghi là bộ phận người tạo" means.
ensure_object "$admin_jar" hr_onboarding "$hr_body"
seed_records "$admin_jar" hr_onboarding "$hr_body" \
  'nhan_su:{"employee_name":"Nguyễn Văn Hùng","position":"Kỹ sư backend","department":"ky_thuat","start_date":"2026-11-03","equipment":"laptop","notes":"Bàn làm việc tầng 3, nhận thiết bị trong ngày đầu tiên."}' \
  'nhan_su:{"employee_name":"Trần Thị Mai","position":"Chuyên viên marketing","department":"marketing","start_date":"2026-11-10","equipment":"laptop_phone","notes":"Cần tài khoản cho hai hệ thống chiến dịch."}'

# ------------------------------------------------- quy trình pilot (D07) ----

purchase_process_body='{
  "key": "purchase_approval",
  "name": "Duyệt đề nghị mua hàng",
  "description": "Trưởng bộ phận duyệt trước; từ 20 triệu trở lên giám đốc duyệt, dưới ngưỡng kế toán xác nhận ngân sách.",
  "objectKey": "purchase_request",
  "nodes": [
    {"key": "start", "type": "start", "title": "Nhận đề nghị"},
    {"key": "department_approval", "type": "human_task", "title": "Trưởng bộ phận duyệt", "assigneeRole": "truong_bo_phan"},
    {"key": "value_gate", "type": "condition", "title": "Từ 20 triệu trở lên?", "condition": {"field": "estimated_amount", "op": "gte", "value": 20000000}},
    {"key": "director_approval", "type": "human_task", "title": "Giám đốc duyệt", "assigneeRole": "giam_doc"},
    {"key": "accounting_check", "type": "human_task", "title": "Kế toán xác nhận ngân sách", "assigneeRole": "ke_toan"},
    {"key": "end", "type": "end", "title": "Kết thúc"}
  ],
  "edges": [
    {"from": "start", "to": "department_approval"},
    {"from": "department_approval", "to": "value_gate"},
    {"from": "value_gate", "to": "director_approval", "when": "true"},
    {"from": "value_gate", "to": "accounting_check", "when": "false"},
    {"from": "director_approval", "to": "end"},
    {"from": "accounting_check", "to": "end"}
  ]
}'

incident_process_body='{
  "key": "incident_triage",
  "name": "Phân loại và xử lý sự cố IT",
  "description": "IT tiếp nhận và phân loại; sự cố nghiêm trọng chuyển trưởng bộ phận chỉ đạo, còn lại IT xử lý và xác nhận hoàn tất.",
  "objectKey": "it_incident",
  "nodes": [
    {"key": "start", "type": "start", "title": "Tiếp nhận báo cáo"},
    {"key": "triage", "type": "human_task", "title": "IT phân loại sự cố", "assigneeRole": "it_support"},
    {"key": "severity_gate", "type": "condition", "title": "Mức độ nghiêm trọng?", "condition": {"field": "severity", "op": "eq", "value": "nghiem_trong"}},
    {"key": "escalate", "type": "human_task", "title": "Trưởng bộ phận IT chỉ đạo xử lý", "assigneeRole": "truong_bo_phan"},
    {"key": "handle", "type": "human_task", "title": "IT xử lý và xác nhận hoàn tất", "assigneeRole": "it_support"},
    {"key": "end", "type": "end", "title": "Kết thúc"}
  ],
  "edges": [
    {"from": "start", "to": "triage"},
    {"from": "triage", "to": "severity_gate"},
    {"from": "severity_gate", "to": "escalate", "when": "true"},
    {"from": "severity_gate", "to": "handle", "when": "false"},
    {"from": "escalate", "to": "end"},
    {"from": "handle", "to": "end"}
  ]
}'

hr_process_body='{
  "key": "hr_onboarding_flow",
  "name": "Onboarding nhân sự",
  "description": "HR chuẩn bị hồ sơ, IT cấp tài khoản và thiết bị, quản lý trực tiếp xác nhận nhận việc. Các bước là việc cần làm, không phải phê duyệt.",
  "objectKey": "hr_onboarding",
  "nodes": [
    {"key": "start", "type": "start", "title": "Mở hồ sơ"},
    {"key": "hr_prepare", "type": "human_task", "title": "HR chuẩn bị hồ sơ và hợp đồng", "assigneeRole": "nhan_su"},
    {"key": "it_setup", "type": "human_task", "title": "IT cấp tài khoản và thiết bị", "assigneeRole": "it_support"},
    {"key": "manager_confirm", "type": "human_task", "title": "Quản lý trực tiếp xác nhận nhận việc", "assigneeRole": "truong_bo_phan"},
    {"key": "end", "type": "end", "title": "Kết thúc"}
  ],
  "edges": [
    {"from": "start", "to": "hr_prepare"},
    {"from": "hr_prepare", "to": "it_setup"},
    {"from": "it_setup", "to": "manager_confirm"},
    {"from": "manager_confirm", "to": "end"}
  ]
}'

echo "seed: publish quy trình pilot"
ensure_process_definition "$admin_jar" purchase_approval "$purchase_process_body"
ensure_process_definition "$admin_jar" incident_triage "$incident_process_body"
ensure_process_definition "$admin_jar" hr_onboarding_flow "$hr_process_body"

# ------------------------------------------------- việc đang chờ (inbox) ----
# Each pilot flow gets one instance resting on a role, so the Tasks screen has real
# work for several people instead of an empty inbox. An instance is only started
# when the role that should hold the task has nothing open for that process yet.

echo "seed: tạo việc đang chờ cho từng quy trình"
truong_jar="$(jar_for seed_truong_ky_thuat@opvaryn.local)"
giam_doc_jar="$(jar_for seed_giam_doc@opvaryn.local)"
it_jar="$(jar_for seed_it@opvaryn.local)"
hr_jar="$(jar_for seed_nhan_su@opvaryn.local)"

# Một đề nghị trên ngưỡng, đã được trưởng bộ phận duyệt: việc tiếp theo của giám đốc.
if inbox_has_task "$giam_doc_jar" purchase_approval; then
  echo "seed: giám đốc đã có việc của purchase_approval, bỏ qua."
else
  record_id="$(record_id_for "$admin_jar" purchase_request title "MacBook Pro 14 inch cho nhân viên mới")"
  instance_id="$(start_instance "$admin_jar" purchase_approval "$record_id")"
  task_id="$(open_task_id "$truong_jar" "$instance_id" department_approval)"
  decide_task "$truong_jar" "$instance_id" "$task_id" approve
  echo "seed: đề nghị 52.900.000đ đã qua trưởng bộ phận, đang chờ giám đốc."
fi

# Một đề nghị dưới ngưỡng còn nguyên ở bước đầu, để inbox có việc mới nhất.
if inbox_has_task "$truong_jar" purchase_approval; then
  echo "seed: trưởng bộ phận đã có việc của purchase_approval, bỏ qua."
else
  record_id="$(record_id_for "$admin_jar" purchase_request title "Màn hình Dell UltraSharp 27 inch")"
  start_instance "$admin_jar" purchase_approval "$record_id" >/dev/null
  echo "seed: đề nghị 9.800.000đ đang chờ trưởng bộ phận duyệt."
fi

# Sự cố nghiêm trọng: bước phân loại của IT mở đường cho nhánh escalation.
if inbox_has_task "$it_jar" incident_triage; then
  echo "seed: IT đã có việc của incident_triage, bỏ qua."
else
  record_id="$(record_id_for "$admin_jar" it_incident summary "Đồng bộ tồn kho ERP lệch so với thực tế")"
  start_instance "$admin_jar" incident_triage "$record_id" >/dev/null
  echo "seed: sự cố ERP nghiêm trọng đang chờ IT phân loại."
fi

# Onboarding mới mở: HR giữ việc đầu tiên của chuỗi HR → IT → quản lý.
if inbox_has_task "$hr_jar" hr_onboarding_flow; then
  echo "seed: HR đã có việc của hr_onboarding_flow, bỏ qua."
else
  record_id="$(record_id_for "$admin_jar" hr_onboarding employee_name "Nguyễn Văn Hùng")"
  start_instance "$admin_jar" hr_onboarding_flow "$record_id" >/dev/null
  echo "seed: hồ sơ Nguyễn Văn Hùng đang chờ HR chuẩn bị."
fi

# ------------------------------------------------------------- metric (D06) ----

# ensure_metric <jar> <key> <json-body>: create the metric only when it is missing.
ensure_metric() {
  local jar="$1" key="$2" body="$3" status
  status="$(request "$jar" GET "/api/v1/metrics/$key")"
  case "$status" in
    200) echo "seed: metric '$key' đã tồn tại, bỏ qua." ;;
    404)
      status="$(request "$jar" POST /api/v1/metrics "$body")"
      [[ "$status" == "201" ]] || fail "tạo metric '$key' trả về $status, mong đợi 201."
      echo "seed: đã tạo metric '$key'."
      ;;
    *) fail "GET metric '$key' trả về $status." ;;
  esac
}

echo "seed: tạo metric mẫu trên dữ liệu thật"
ensure_metric "$admin_jar" purchase_amount_by_department '{
  "key": "purchase_amount_by_department",
  "name": "Giá trị đề nghị theo bộ phận",
  "description": "Tổng giá trị dự kiến của các đề nghị mua hàng, nhóm theo bộ phận đề nghị.",
  "objectKey": "purchase_request",
  "aggregation": "sum",
  "field": "estimated_amount",
  "groupBy": "department"
}'
ensure_metric "$admin_jar" purchase_requests_above_20m '{
  "key": "purchase_requests_above_20m",
  "name": "Đề nghị từ 20 triệu trở lên",
  "description": "Số đề nghị vượt ngưỡng giám đốc duyệt — đúng ngưỡng mà quy trình purchase_approval dùng.",
  "objectKey": "purchase_request",
  "aggregation": "count",
  "filter": {"field": "estimated_amount", "op": "gte", "value": 20000000}
}'
ensure_metric "$admin_jar" incidents_by_severity '{
  "key": "incidents_by_severity",
  "name": "Sự cố theo mức độ",
  "description": "Số sự cố IT đã ghi nhận, nhóm theo mức độ — cơ sở cho việc định tuyến của incident_triage.",
  "objectKey": "it_incident",
  "aggregation": "count",
  "groupBy": "severity"
}'

echo "seed: hoàn tất. Mở http://localhost:21500/objects để xem dữ liệu."
echo "seed: http://localhost:21500/tasks để xem việc đang chờ (đăng nhập bằng tài khoản seed_*)."
if [[ "$skipped" == "1" ]]; then
  echo "seed: có object bị bỏ qua do schema khác — xem cảnh báo ở trên." >&2
fi
