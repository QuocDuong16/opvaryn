#!/usr/bin/env bash
#
# Seeds the demo dataset through the public API, so the data has exactly the shape
# a user would create by hand. Two objects the playbook names as candidate pilots
# are seeded with a handful of records: purchase requests and IT incidents.
#
# Idempotent: an object is created only when its key is missing, and records are
# added only while the object has none. Safe to re-run. When an object already
# exists with a different schema, its records are skipped with a warning instead
# of failing — the demo cannot migrate definitions yet (schema editing is MVP).
#
# Requires: the API running against migrated PostgreSQL (make docker-up,
# cd apps/api && go run ./cmd/migrate, make dev-api).
#
# Usage: bash scripts/seed-demo.sh   (or: make seed-demo)
set -euo pipefail

base_url="${API_BASE_URL:-http://localhost:21501}"
body_file="$(mktemp -t opvaryn-seed-body.XXXXXX)"
trap 'rm -f "$body_file"' EXIT
skipped=0

fail() {
  echo "seed: FAIL: $*" >&2
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

# field_keys <json-body>: prints the field keys of a definition body or response.
field_keys() {
  python3 -c 'import json,sys; print(" ".join(f["key"] for f in json.loads(sys.argv[1]).get("fields") or []))' "$1"
}

curl -sf "$base_url/readyz" >/dev/null ||
  fail "API chưa sẵn sàng tại $base_url — chạy 'make docker-up', migrate rồi 'make dev-api' trước."

# ensure_object <key> <json-body>: create the definition only when it is missing.
ensure_object() {
  local key="$1" body="$2" status
  status="$(request GET "/api/v1/business-objects/$key")"
  case "$status" in
    200) echo "seed: business object '$key' đã tồn tại, bỏ qua." ;;
    404)
      status="$(request POST /api/v1/business-objects "$body")"
      [[ "$status" == "201" ]] || fail "tạo business object '$key' trả về $status, mong đợi 201."
      echo "seed: đã tạo business object '$key'."
      ;;
    *) fail "GET business object '$key' trả về $status." ;;
  esac
}

# ensure_records_match_schema <key> <json-body>: warn (and skip) when the stored
# definition does not declare every field the demo records use.
ensure_records_match_schema() {
  local key="$1" body="$2" status actual expected field
  status="$(request GET "/api/v1/business-objects/$key")"
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

# seed_records <key> <json-body> <json-values>...: add records only while the
# object has none and only when its schema matches the demo definition.
seed_records() {
  local key="$1" body="$2"
  shift 2
  local status values

  if ! ensure_records_match_schema "$key" "$body"; then
    return 0
  fi

  status="$(request GET "/api/v1/business-objects/$key/records")"
  [[ "$status" == "200" ]] || fail "GET records của '$key' trả về $status."

  if grep -q '"data":\[\]' "$body_file"; then
    for values in "$@"; do
      status="$(request POST "/api/v1/business-objects/$key/records" "{\"values\":$values}")"
      [[ "$status" == "201" ]] || fail "tạo bản ghi cho '$key' trả về $status, mong đợi 201."
    done
    echo "seed: đã thêm bản ghi demo cho '$key'."
  else
    echo "seed: '$key' đã có bản ghi, bỏ qua."
  fi
}

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

ensure_object purchase_request "$purchase_body"
seed_records purchase_request "$purchase_body" \
  '{"title":"MacBook Pro 14 inch cho nhân viên mới","requester":"Trần Minh Anh","department":"ky_thuat","estimated_amount":52900000,"needed_by":"2026-11-01","justification":"Thay máy đã hết bảo hành, phục vụ dự án OPVARYN.","items":["MacBook Pro 14 M5 24GB","AppleCare+ 3 năm"]}' \
  '{"title":"Màn hình Dell UltraSharp 27 inch","requester":"Lê Hoàng","department":"ky_thuat","estimated_amount":9800000,"needed_by":"2026-10-25","items":["Dell U2723QE"]}' \
  '{"title":"Bàn phím cơ và chuột ergonomic","requester":"Phạm Thu Hà","department":"van_hanh","estimated_amount":3200000,"needed_by":"2026-10-30","justification":"Bổ sung thiết bị cho bàn làm việc mới.","items":["Keychron K8 Pro","Logitech MX Master 3S"]}' \
  '{"title":"Gói dịch vụ thiết kế landing page","requester":"Nguyễn Quốc Bảo","department":"marketing","estimated_amount":24500000,"needed_by":"2026-11-15","justification":"Chiến dịch ra mắt quý 4."}' \
  '{"title":"Ghế công thái học cho phòng họp","requester":"Đỗ Thanh Mai","department":"kinh_doanh","estimated_amount":15000000,"needed_by":"2026-12-01","items":["Ghế ergonomic x3"]}'

ensure_object it_incident "$incident_body"
seed_records it_incident "$incident_body" \
  '{"summary":"Không đăng nhập được VPN sau khi đổi mật khẩu","reporter":"Vũ Nhật Linh","severity":"cao","system":"vpn","opened_at":"2026-10-09","impact":"3 nhân viên không truy cập được hệ thống nội bộ."}' \
  '{"summary":"Đồng bộ tồn kho ERP lệch so với thực tế","reporter":"Bùi Anh Tuấn","severity":"nghiem_trong","system":"erp","opened_at":"2026-10-08","impact":"Báo cáo tồn kho sai lệch ở 2 mã hàng."}' \
  '{"summary":"Hộp thư dùng chung không nhận được email từ đối tác","reporter":"Nguyễn Thảo Vy","severity":"trung_binh","system":"email","opened_at":"2026-10-10","impact":"Chậm phản hồi yêu cầu mua hàng."}' \
  '{"summary":"Laptop khởi động chậm sau bản cập nhật","reporter":"Hoàng Minh Đức","severity":"thap","system":"laptop","opened_at":"2026-10-11","impact":"Thời gian khởi động khoảng 4 phút."}'

echo "seed: hoàn tất. Mở http://localhost:21500/objects để xem dữ liệu."
if [[ "$skipped" == "1" ]]; then
  echo "seed: có object bị bỏ qua do schema khác — xem cảnh báo ở trên." >&2
fi
