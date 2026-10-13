# 0003 — Lát cắt dữ liệu của demo: bản ghi business object và phân chia live/mock

- **Ngày**: 2026-10-13
- **Trạng thái**: Accepted (phạm vi bản demo)
- **Liên quan**: [0002](0002-demo-scope-and-labels.md), playbook `demo-mvp.html` (kế hoạch 8 tuần),
  `modules.html` mục 01–07, `architecture.html` mục 04

## Bối cảnh

ADR 0002 chốt rằng demo chỉ chạy thật ở lát cắt business object và mọi màn hình phải gắn nhãn
`live`/`mock`/`concept`. Kế hoạch 8 tuần sau đó yêu cầu thêm: Form Builder (tuần 2–3), Workflow &
Task experience (tuần 4–5), Analytics Studio (tuần 6), Application Builder showcase (tuần 7). Câu
hỏi đặt ra là phần nào được phép chạm vào database, phần nào phải dừng ở mô phỏng.

Giới hạn đã biết: Process Execution Contract (D05/D08) cùng Rule DSL (D04), Analytics build-vs-embed
(D06) và Identity (D09) vẫn là quyết định mở. Runtime viết trước khi chốt sẽ khóa sớm những quyết
định chưa được review (bất biến 1 và 2 trong playbook).

## Quyết định

1. **Bản ghi business object là phần chạy thật thứ hai**, nối tiếp định nghĩa: bảng
   `business_object_records` lưu `values` dạng JSONB, khóa theo `object_id`. Validation theo field
   definition nằm ở service Go (unknown key, required, kiểu dữ liệu, options của `select`) trước
   khi ghi. Đây là "engine validate tập trung" mà playbook yêu cầu cho Form Builder.
2. **Schema đi cùng feature**: `select` field được bổ sung `options` vào contract; chưa có chỉnh
   sửa schema sau khi tạo (thuộc MVP) nên một object đã tồn tại với schema khác sẽ không được seed
   bản ghi — script seed cảnh báo thay vì fail.
3. **Form Builder là thật ở phần nhập liệu**: form nhập bản ghi được sinh trực tiếp từ schema và
   dùng chung một component giữa màn hình object detail và trang Forms. Điều kiện hiển thị,
   calculated field, upload tệp và lookup ngoài vẫn là `concept` vì phụ thuộc D04/D05 và object
   storage.
4. **Workflow, Task Inbox và Analytics là màn hình mô phỏng**: sơ đồ quy trình, inbox và dashboard
   đọc từ fixture trong mã nguồn web; thao tác duyệt/trả về/từ chối chỉ đổi state trong trình duyệt
   (reducer thuần, có unit test). Không có bảng process/task/event, không có state machine — đúng
   giới hạn ADR 0002.
5. **Application showcase trộn hai loại**: view danh sách và chi tiết đọc bản ghi thật; kanban và
   panel connector là mô phỏng, gắn nhãn theo từng view. Nhãn trạng thái đặt ở cấp view, không chỉ
   cấp trang.
6. **Dữ liệu demo được nạp qua chính API** (`make seed-demo`), không qua SQL trực tiếp, để dữ liệu
   luôn có đúng hình dạng mà người dùng tạo được bằng tay.

## Hệ quả

- Demo trả lời được câu hỏi "dữ liệu động hoạt động thế nào": schema → form → validate → JSONB, và
  đổi object là đổi form/table mà không sửa code.
- Những câu hỏi vận hành thật (SLA, concurrency, retry, phân quyền theo dữ liệu) vẫn chưa được trả
  lời ở bất kỳ màn hình nào; người trình bày phải nói rõ khi dùng Tasks/Analytics.
- Migration `0002_business_object_records.sql` đã áp dụng là bất biến. Khi runtime workflow bắt đầu,
  nó cần migration mới và một ADR mô tả execution contract đã chốt.
- Read model có kiểu cho metric vẫn là việc của MVP: hiện chưa có projection từ `values` sang cột
  hoặc bảng đo lường (bất biến 5).
