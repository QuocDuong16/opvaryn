#!/usr/bin/env bash
#
# Seeds the demo dataset through the public API, so the data has exactly the shape
# a user would create by hand. Two objects the playbook names as candidate pilots
# are seeded with a handful of records: purchase requests and IT incidents.
#
# Since ADR 0008 the API needs a session and records carry the department of the
# session that created them, so this script bootstraps one account per department
# and creates each record as that department. That is what makes the department
# scoping visible in the demo instead of theoretical.
#
# Idempotent: departments and users are created only when missing, objects only
# when their key is missing, and records only while the object has none.
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

# jar_for <department> [email] -> path of a cookie jar signed in as that account
jar_for() {
  local department="$1" email="${2:-seed_$1@opvaryn.local}"
  local jar="$jar_dir/$department.cookies"
  if [[ ! -f "$jar" ]]; then
    login "$jar" "$email" ||
      fail "không đăng nhập được tài khoản '$email'"
  fi
  printf '%s' "$jar"
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
    jar="$(jar_for "$department")"
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
ensure_user seed@opvaryn.local "Tài khoản seed" ban_giam_doc "admin"
for department in ky_thuat kinh_doanh van_hanh marketing; do
  ensure_user "seed_$department@opvaryn.local" "Seed $department" "$department" "nhan_vien"
done

admin_jar="$(jar_for ban_giam_doc seed@opvaryn.local)"

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

echo "seed: hoàn tất. Mở http://localhost:21500/objects để xem dữ liệu."
if [[ "$skipped" == "1" ]]; then
  echo "seed: có object bị bỏ qua do schema khác — xem cảnh báo ở trên." >&2
fi
