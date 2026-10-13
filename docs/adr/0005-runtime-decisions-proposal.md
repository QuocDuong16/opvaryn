# 0005 — Đề xuất quyết định cho execution contract (D04, D05, D08)

- **Ngày**: 2026-10-13
- **Trạng thái**: **Proposed — chờ chủ dự án chốt** (không phải quyết định đã ban hành)
- **Liên quan**: playbook `architecture.html` mục 04, `decisions.html` (D04, D05, D08),
  [0002](0002-demo-scope-and-labels.md), [0003](0003-demo-data-slice-and-mock-surfaces.md),
  [0006](0006-definition-versioning.md)

## Bối cảnh

MVP V1 cần workflow runtime, nhưng ba quyết định trong playbook vẫn mở và chúng khoá kiến trúc:
viết runtime trước khi chốt sẽ đóng băng những lựa chọn chưa được review (điều ADR 0002 cấm).
ADR này gom chúng thành một bản đề xuất để chủ dự án chốt một lần, kèm giá phải trả của từng
phương án. Cho tới khi chốt, repo chỉ làm phần không phụ thuộc các quyết định này (xem ADR 0006).

## D05 — Workflow runtime strategy

| Phương án | Hạ tầng | License | Được gì | Giá phải trả |
| --- | --- | --- | --- | --- |
| **Tự xây trên PostgreSQL** (đề xuất) | không thêm | không đổi | Giữ trọn ba bất biến bằng một transaction cho mỗi transition; không thêm hệ thống phải vận hành; dùng lại đúng kỹ năng và gate hiện có | Tự chịu trách nhiệm durability: outbox, job queue (`FOR UPDATE SKIP LOCKED`), retry/backoff, chống chạy trùng. Playbook ước lượng ~4 tuần |
| Temporal | + server + worker | MIT | Durable execution đã được chứng minh; retry/timer có sẵn | Vận hành nặng cho 2–3 quy trình nội bộ; phải học mô hình workflow determinism; thêm hai tiến trình vào CI và máy dev |
| Zeebe / Camunda 8 | + broker + gateway (+ Elasticsearch) | lõi Apache-2.0, bộ Camunda 8 phải kiểm tra | BPMN native, tooling đầy đủ | Nặng nhất; phụ thuộc sản phẩm bên ngoài ngay từ MVP; nhiều khái niệm phải ánh xạ |
| Durable queue Go-native (vd Hatchet) | + hàng đợi | chưa xác nhận | Nhẹ hơn Temporal | Chưa kiểm chứng license/độ chín; chính sách repo chỉ nhận MIT/BSD/Apache/ISC nên phải có bước đánh giá riêng |

**Đề xuất**: tự xây trên PostgreSQL. Lý do: quy mô MVP là một tổ chức nội bộ, 2–3 quy trình, không
cần multi-region hay hàng nghìn instance đồng thời; ba bất biến của playbook (version bất biến,
transition đúng một lần, lỗi tích hợp không đảo ngược quyết định) đều enforce được ở tầng SQL mà
không cần engine ngoài; và nó giữ đúng ranh giới modular monolith của ADR 0001. Nếu sau pilot số
quy trình hoặc số bước tăng mạnh, việc đã viết (transition + outbox) vẫn là dữ liệu và quy ước
đúng để chuyển sang engine ngoài.

## D08 — Approval semantics

Hai câu hỏi độc lập; đề xuất cho từng câu:

1. **Từ chối / trả về.** Đề xuất: `rejected` là **terminal** (không gửi lại trên instance đó);
   `returned` đưa instance về người lập và **reset toàn bộ bước đã duyệt**, chạy lại từ Start.
   Lý do: dễ giải thích cho người dùng, audit đơn giản (một instance = một mạch thực thi),
   không phải định nghĩa "bước bị trả" và state của các bước sau. Muốn người duyệt đỡ lặp việc thì
   thêm ở V1.x (re-approval có kiểm soát), không đưa vào MVP.
2. **Resolver người duyệt.** Đề xuất: **theo role** — task gán cho role (trưởng bộ phận, kế toán,
   giám đốc); ai có role đều thấy trong inbox, người xử lý trước nhận task và các task trùng tự
   đóng (cần compare-and-swap). Lý do: không cần org chart, không phải đồng bộ dữ liệu tổ chức,
   và vẫn đúng nghiệp vụ cho các quy trình trong playbook. Gán người cụ thể hoặc trưởng bộ phận
   của người gửi là hai bước nâng cấp rõ ràng về sau.

## D04 — Rule DSL cho node điều kiện

| Phương án | Dependency | Được gì | Giá phải trả |
| --- | --- | --- | --- |
| **JSON condition giới hạn** (đề xuất) | không | `{field, op, value}` với allowlist toán tử, kiểm type theo field definition; lỗi báo sát field; admin không phải học cú pháp | Không có biểu thức/hàm; điều kiện phức tạp phải nâng cấp sau |
| CEL (cel-go) | Apache-2.0 | Chuẩn hoá, sandbox an toàn, hàm/list/map, kiểm type tốt | Thêm dependency; mặt lỗi rộng hơn cho người cấu hình |
| expr-lang/expr | MIT | Go-native, cú pháp gọn, compile kiểm type | Ít chuẩn hoá hơn CEL; vẫn là dependency mới |

**Đề xuất**: JSON condition giới hạn cho MVP. Nó đủ cho các nhánh thật trong playbook (ngưỡng giá
trị, mức độ sự cố, bộ phận) và tránh đưa một ngôn ngữ biểu thức vào trước khi có nhu cầu thật.
Điều kiện phức tạp là lý do chính đáng để nâng lên CEL ở V1.x, và khi đó việc migrate là chuyển
đổi dữ liệu condition đã lưu.

## Cần chủ dự án trả lời

Chốt được bằng một dòng cho mỗi mục (hoặc "theo đề xuất"):

- **D05**: tự xây trên PostgreSQL / Temporal / Zeebe-Camunda 8 / đánh giá tiếp phương án khác?
- **D08a**: từ chối = terminal và trả về = làm lại từ đầu? (hoặc: giữ các bước đã duyệt? cho gửi lại?)
- **D08b**: resolver theo role? (hoặc: người cụ thể / trưởng bộ phận của người gửi?)
- **D04**: JSON condition giới hạn? (hoặc: CEL / expr?)

## Hệ quả

- Khi chốt, các mục D04/D05/D08 chuyển thành ADR `Accepted` và bản này được cập nhật trạng thái;
  runtime chỉ được viết sau đó, kèm migration mới (không sửa migration đã áp dụng).
- Vòng quyết định tiếp theo, cần trước khi làm auth/inbox và analytics thật: **D09** (identity:
  local auth hay SSO, phạm vi RBAC/ABAC), **D07** (2–3 quy trình pilot cụ thể), **D06** (analytics
  build vs embed), **D10** (deployment, backup, môi trường).
- Việc đang làm mà không cần chờ: versioning cho definition ([ADR 0006](0006-definition-versioning.md)) —
  bất biến #1 của playbook và là mục "Config versioning" trong MVP.
