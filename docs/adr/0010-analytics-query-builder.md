# 0010 — Analytics: query builder giới hạn tự viết trên projection có kiểu (D06)

- **Ngày**: 2026-10-14
- **Trạng thái**: Accepted (mốc MVP V1)
- **Liên quan**: playbook `decisions.html` (D06), `modules.html` (Analytics),
  [0004](0004-dashboard-layout-storage-and-demo-flow-tests.md) (bố cục dashboard),
  [0006](0006-definition-versioning.md) (bản ghi gắn với phiên bản), [0008](0008-identity-permissions-pilot-and-deployment.md) (phạm vi đọc)

## Bối cảnh

D06 hỏi: dashboard có số liệu thật thì dùng embedded BI hay tự viết query builder giới hạn. Màn hình
Analytics trước bước này chỉ có bố cục thật còn số liệu là fixture, và điều kiện nghiệm thu #6 của
playbook ("người quản lý tự cấu hình dashboard cơ bản với metric được cấp quyền") chưa đạt.

Hai ràng buộc đã có sẵn và không được phá:

- **AGENTS.md**: field nào bị lọc, join hoặc **đo** thì phải có projection hoặc read model có kiểu —
  không tính toán trên JSONB lúc truy vấn.
- **ADR 0008**: mọi lần đọc dữ liệu đều theo phạm vi (bộ phận, bản ghi mình tạo, bản ghi mình đang giữ
  việc). Một metric không được mở rộng thứ mà người dùng được đọc.

## Quyết định

1. **Tự viết, giới hạn, không SQL tự do** (chủ dự án chốt ngày 2026-10-14). Một metric là: một
   business object, một aggregation (`count`/`sum`/`avg`), nhiều nhất một filter và nhiều nhất một
   field để nhóm. Không biểu thức, không hàm, không subquery, không JOIN do người dùng khai báo.
2. **Ngôn ngữ lọc là ngôn ngữ điều kiện sẵn có** (D04): cùng shape `{field, op, value}` và **cùng
   validator** với nhánh điều kiện của quy trình. Một sản phẩm, một cách nói "so sánh field này với
   giá trị kia"; thêm toán tử mới là sửa một chỗ.
3. **Projection có kiểu, ghi cùng transaction với bản ghi.** `record_field_values` giữ một dòng cho
   mỗi field của mỗi bản ghi, giá trị nằm ở cột theo kiểu (text/number/date). Migration backfill dữ
   liệu cũ theo **phiên bản định nghĩa của chính bản ghi** (ADR 0006); bản ghi mới được project trong
   cùng transaction, nên không tồn tại bản ghi nào mà metric không thấy. Field `rows` không được
   project (không có giá trị vô hướng) và vì vậy không đo được.
4. **Kiểu của field được chốt lúc lưu metric.** `field_kind`, `group_kind`, `filter_kind` nằm trong
   `metric_definitions`, nên sửa schema của object sau đó không làm metric cũ đổi nghĩa hay hỏng:
   metric tiếp tục đo đúng cái nó được định nghĩa để đo.
5. **Truy vấn sinh từ một plan, không từ input.** Service phân giải metric thành `MetricQuery`
   (object, aggregation, các field kèm kind, filter); store dựng SQL với aggregation, toán tử và cột
   lấy từ allowlist, còn **mọi giá trị đi qua bind parameter**. Store không biết gì về field
   definition hay quyền; service không biết gì về SQL.
6. **Phạm vi đọc áp nguyên xi**: truy vấn join về `business_object_records` và dùng chính
   `recordVisibleToScope` của ADR 0008. Hệ quả được nói rõ trên màn hình: hai người xem cùng một
   metric có thể thấy hai con số khác nhau, và đó là thiết kế, không phải lỗi. Kết quả trả kèm
   `records` để người đọc biết con số dựa trên bao nhiêu bản ghi.
7. **Metric là cấu hình**: tạo/sửa cần `admin` hoặc `process_designer` (cùng luật với định nghĩa
   business object và quy trình). Đọc và chạy metric mở cho mọi user đã đăng nhập, theo phạm vi.
8. **Bố cục dashboard trỏ vào metric key** (không còn fixture): widget là `{metricKey, view}` với
   `view` là một con số hoặc phân rã theo nhóm. Module bố cục nhận danh sách metric hợp lệ từ ngoài
   (dữ liệu server) thay vì import một catalog trong code; ghi thì strict, đọc thì lenient
   (ADR 0004 giữ nguyên lý do lưu bằng cookie).
9. **Không thêm hệ thống nào.** Không Superset, không Metabase (Metabase OSS là AGPL, chính sách
   dependency của repo loại), không thêm service phải vận hành và phải đồng bộ quyền hai nơi.

## Hệ quả

- Điều kiện nghiệm thu #6 đạt: người quản lý tự dựng metric từ field của object và tự sắp dashboard,
  trên số liệu thật, trong đúng phạm vi dữ liệu họ được đọc.
- Metric đo **field của bản ghi**. Metric vận hành (cycle time, approval rate, rework rate, SLA) cần
  read model trên `process_events`/`process_tasks` — chúng được liệt kê trên màn hình với nhãn
  `concept` và là việc tiếp theo, không giả vờ đã có.
- Một filter và một grouping là giới hạn có ý thức: đủ cho dashboard pilot, và mở rộng sau này là
  thêm cấu trúc vào cùng shape chứ không phải viết lại ngôn ngữ.
- Projection làm bản ghi nặng thêm một chút khi ghi (một INSERT cho mỗi field). Đổi lại, không có
  truy vấn nào phải đọc JSONB, và index đã sẵn cho (object, field, value).
- Khi cần BI đầy đủ (drill-down, biểu đồ tuỳ ý, cross-dataset), đó là một quyết định mới — dữ liệu đã
  nằm trong PostgreSQL với projection có kiểu nên một công cụ ngoài có thể đọc thẳng.
