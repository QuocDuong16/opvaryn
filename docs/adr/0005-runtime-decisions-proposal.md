# 0005 — Quyết định cho execution contract (D04, D05, D08)

- **Ngày**: 2026-10-13 (chốt 2026-10-13)
- **Trạng thái**: **Accepted** — chủ dự án đã chốt cả bốn mục
- **Liên quan**: playbook `architecture.html` mục 04, `decisions.html` (D04, D05, D08),
  [0002](0002-demo-scope-and-labels.md), [0003](0003-demo-data-slice-and-mock-surfaces.md),
  [0006](0006-definition-versioning.md), [0007](0007-process-execution-contract.md)

## Quyết định đã chốt

| Mã | Chốt | Thay cho đề xuất |
| --- | --- | --- |
| **D05** | **Tự xây runtime trên PostgreSQL** | đúng đề xuất |
| **D04** | **JSON condition giới hạn** (`{field, op, value}`, allowlist toán tử, kiểm type theo field definition) | đúng đề xuất |
| **D08a** | **Từ chối là terminal; trả về reset toàn bộ bước đã duyệt và chạy lại từ Start** | đúng đề xuất |
| **D08b** | **Resolver theo role** — ai có role đều thấy trong inbox, người xử lý trước thắng bằng compare-and-swap | đúng đề xuất |

Hợp đồng thực thi chi tiết (lifecycle, transition, concurrency, versioning, audit) nằm ở
[ADR 0007](0007-process-execution-contract.md).

## Bối cảnh (giữ lại để đọc lại lý do)

MVP V1 cần workflow runtime, nhưng ba quyết định trong playbook vẫn mở và chúng khoá kiến trúc:
viết runtime trước khi chốt sẽ đóng băng những lựa chọn chưa được review (điều ADR 0002 cấm).
ADR này gom chúng thành một bản đề xuất để chủ dự án chốt một lần, kèm giá phải trả của từng
phương án — phần dưới giữ nguyên các phương án đã cân nhắc để sau này biết vì sao chọn như vậy.

Cho tới khi chốt, repo chỉ làm phần không phụ thuộc các quyết định này (xem ADR 0006).

## D05 — Workflow runtime strategy

| Phương án | Hạ tầng | License | Được gì | Giá phải trả |
| --- | --- | --- | --- | --- |
| **Tự xây trên PostgreSQL** (đã chọn) | không thêm | không đổi | Giữ trọn ba bất biến bằng một transaction cho mỗi transition; không thêm hệ thống phải vận hành; dùng lại đúng kỹ năng và gate hiện có | Tự chịu trách nhiệm durability: outbox, job queue (`FOR UPDATE SKIP LOCKED`), retry/backoff, chống chạy trùng. Playbook ước lượng ~4 tuần |
| Temporal | + server + worker | MIT | Durable execution đã được chứng minh; retry/timer có sẵn | Vận hành nặng cho 2–3 quy trình nội bộ; phải học mô hình workflow determinism; thêm hai tiến trình vào CI và máy dev |
| Zeebe / Camunda 8 | + broker + gateway (+ Elasticsearch) | lõi Apache-2.0, bộ Camunda 8 phải kiểm tra | BPMN native, tooling đầy đủ | Nặng nhất; phụ thuộc sản phẩm bên ngoài ngay từ MVP; nhiều khái niệm phải ánh xạ |
| Durable queue Go-native (vd Hatchet) | + hàng đợi | chưa xác nhận | Nhẹ hơn Temporal | Chưa kiểm chứng license/độ chín; chính sách repo chỉ nhận MIT/BSD/Apache/ISC nên phải có bước đánh giá riêng |

## D08 — Approval semantics

1. **Từ chối / trả về** (chốt): `rejected` là **terminal** (không gửi lại trên instance đó);
   `returned` đưa instance về người lập và **reset toàn bộ bước đã duyệt**, chạy lại từ Start
   (tăng `attempt` của instance, huỷ mọi task đang mở, tạo task mới). Lý do: dễ giải thích cho
   người dùng, audit đơn giản (một instance = một mạch thực thi), không phải định nghĩa "bước bị
   trả" và state của các bước sau. Muốn người duyệt đỡ lặp việc thì thêm ở V1.x (re-approval có
   kiểm soát), không đưa vào MVP.
2. **Resolver người duyệt** (chốt): **theo role** — task gán cho role (trưởng bộ phận, kế toán,
   giám đốc); ai có role đều thấy trong inbox, người xử lý trước nhận task và các task trùng tự
   đóng (compare-and-swap). Lý do: không cần org chart, không phải đồng bộ dữ liệu tổ chức, và vẫn
   đúng nghiệp vụ cho các quy trình trong playbook. Gán người cụ thể hoặc trưởng bộ phận của người
   gửi là hai bước nâng cấp rõ ràng về sau — resolver là cấu hình của node, nên nâng cấp không phải
   viết lại engine.

## D04 — Rule DSL cho node điều kiện

| Phương án | Dependency | Được gì | Giá phải trả |
| --- | --- | --- | --- |
| **JSON condition giới hạn** (đã chọn) | không | `{field, op, value}` với allowlist toán tử, kiểm type theo field definition; lỗi báo sát field; admin không phải học cú pháp | Không có biểu thức/hàm; điều kiện phức tạp phải nâng cấp sau |
| CEL (cel-go) | Apache-2.0 | Chuẩn hoá, sandbox an toàn, hàm/list/map, kiểm type tốt | Thêm dependency; mặt lỗi rộng hơn cho người cấu hình |
| expr-lang/expr | MIT | Go-native, cú pháp gọn, compile kiểm type | Ít chuẩn hoá hơn CEL; vẫn là dependency mới |

## Hệ quả

- Runtime được viết kèm migration mới (`0004_process_runtime.sql`) và ADR 0007 mô tả hợp đồng thực
  thi — đúng yêu cầu mà ADR 0002 đặt ra cho thời điểm này.
- Vòng quyết định tiếp theo, cần trước khi làm auth/inbox UI và analytics thật: **D09** (identity:
  local auth hay SSO, phạm vi RBAC/ABAC), **D07** (2–3 quy trình pilot cụ thể), **D06** (analytics
  build vs embed), **D10** (deployment, backup, môi trường).
- Việc đã làm mà không cần chờ: versioning cho definition ([ADR 0006](0006-definition-versioning.md)).
