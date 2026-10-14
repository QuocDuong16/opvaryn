# 0011 — Metric vận hành quy trình: read model cố định trên cột có kiểu

- **Ngày**: 2026-10-14
- **Trạng thái**: Accepted
- **Liên quan**: [0007](0007-process-execution-contract.md) (hợp đồng thực thi), [0010](0010-analytics-query-builder.md) (query builder cho field của bản ghi)

## Bối cảnh

ADR 0010 chốt analytics là query builder tự viết **trên field của business object**. Nhưng những
metric vận hành mà playbook nêu tên — cycle time, thời gian một bước, tỉ lệ duyệt, tỉ lệ phải chạy
lại, SLA — không đo field nào cả: chúng đo **thời gian và trạng thái của chính quy trình**, tức là
`process_instances` và `process_tasks`. Màn hình Analytics đang liệt kê chúng với nhãn `concept`.

Câu hỏi: mở rộng query builder để người dùng tự định nghĩa cả metric thời gian, hay cho chúng một
read model riêng?

## Quyết định

1. **Read model riêng, danh mục cố định.** `GET /api/v1/process-metrics` trả một bộ số đã định nghĩa
   sẵn: instance đã chạy / hoàn tất / bị từ chối / đang chạy, cycle time (trung bình + trung vị + số
   mẫu), thời gian một bước, tỉ lệ duyệt, tỉ lệ phải chạy lại. Không có định nghĩa do người dùng tạo.
   Lý do: mỗi con số này chỉ có **một** định nghĩa đúng (ví dụ "cycle time" phải là từ lúc start tới
   lúc kết thúc), và để người dùng tự định nghĩa lại chúng là mở đường cho hai báo cáo cùng tên khác
   nghĩa. Cái gì đo field của bản ghi thì thuộc query builder (D06); cái gì đo quy trình thì thuộc
   read model này.
2. **Không bảng mới, không projection mới.** Dữ liệu cần thiết đã nằm ở cột có kiểu
   (`started_at`, `finished_at`, `attempt`, `state`, `created_at`, `decided_at`). Yêu cầu "field bị đo
   phải có projection có kiểu" trong AGENTS.md nói về payload JSONB; ở đây không có JSONB nào để đọc.
   Vì vậy đây là các truy vấn tổng hợp trực tiếp, không phải một bảng tổng hợp phải refresh.
3. **Phạm vi đọc áp nguyên xi.** Mọi truy vấn join về `business_object_records` và dùng
   `recordVisibleToScope` (ADR 0008), nên số vận hành của một người chỉ tính trên instance họ được
   đọc. Hệ quả được nói trên màn hình: hai người có thể thấy hai bộ số khác nhau.
4. **Tỉ lệ trên "không có gì" là vắng, không phải 0.** `approvalRate`/`reworkRate` là `null` khi chưa
   có instance nào kết thúc (hoặc chưa có instance nào) — trả 0 sẽ bị đọc thành "0%", một khẳng định
   sai. Giao diện hiện "chưa có dữ liệu".
5. **Cửa sổ thời gian là tham số bắt buộc có giới hạn**: `windowDays` 1–365, mặc định 30; cycle time
   tính trên instance kết thúc trong cửa sổ, thời gian một bước tính trên task được quyết định trong
   cửa sổ (task quyết định muộn không lọt vào cửa sổ khác). Bộ lọc `definitionKey` phải là định nghĩa
   có thật, nếu không là 404 — gõ sai key không được trả về dashboard rỗng.
6. **SLA vẫn không có**, và điều đó được nói thẳng trên màn hình: tỉ lệ vi phạm SLA cần chính sách
   thời gian làm việc mà engine chưa có (timer/escalation thuộc V1.x, ADR 0007 mục 12). Không hiển thị
   hạn giả.

## Hệ quả

- Màn hình Analytics không còn bảng `concept` nào: số liệu field (query builder) và số liệu vận hành
  (read model) đều là thật, có nhãn `live`, kèm bộ lọc quy trình và cửa sổ thời gian.
- Bộ số này là chỗ để cắm thêm khi engine mở rộng: có timer/SLA thì thêm `slaBreachRate` vào cùng
  endpoint; có parallel/join thì thêm số liệu nhánh. Không cần đổi mô hình metric.
- Truy vấn tổng hợp chạy trên `process_instances`/`process_tasks` mỗi lần mở trang: đủ nhanh ở quy mô
  pilot, và khi lớn hơn thì bước tiếp theo là materialized view — không phải đổi API.
