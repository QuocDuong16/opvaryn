# 0017 — Danh sách phân trang ở API; màn hình không bao giờ tải cả bảng

- **Ngày**: 2026-10-15
- **Trạng thái**: Accepted
- **Liên quan**: [0008](0008-identity-permissions-pilot-and-deployment.md) (phạm vi đọc),
  [0011](0011-process-operational-metrics.md) (read model cố định),
  [0016](0016-display-names-instead-of-keys.md) (màn hình đọc được)

## Bối cảnh

Mọi endpoint danh sách trả về **toàn bộ** bảng: `GET /api/v1/business-objects` trả 118 object sau
một ngày chạy thử, `/records`, `/tasks`, `/process-instances` cũng vậy (chỉ instance có trần 200
và một bộ lọc). Màn hình nhận hết rồi tự cắt bằng `slice()` — nghĩa là dữ liệu vẫn đi qua mạng,
vẫn dựng DOM, và người dùng vẫn phải cuộn qua một bảng không có lối thoát. Không có tìm kiếm, không
có số trang, không có tổng số.

## Quyết định

1. **Phân trang thuộc về API.** Năm endpoint danh sách (`business-objects`, `records`, `tasks`,
   `process-definitions`, `process-instances`) nhận `limit` và `offset`, và trả `{data, total}`:
   màn hình biết mình đang ở đâu trong bao nhiêu dòng mà không cần hỏi thêm lần nào. Mặc định 25
   dòng, trần 100 — đủ cho một màn hình, không đủ để biến API thành công cụ export.
2. **Tìm kiếm chạy ở server.** `q` lọc theo tên và khoá (bản ghi: trong giá trị đã lưu; hộp việc:
   theo tên việc và tên quy trình). Đây là bộ lọc cho màn hình, không phải ngôn ngữ truy vấn: tối
   đa 100 ký tự, và giá trị vượt giới hạn bị từ chối.
3. **Giá trị sai bị từ chối kèm tên tham số.** `limit`/`offset` không phải số, hoặc ngoài khoảng,
   trả 400 với câu nói rõ tham số nào sai — người gọi đọc được, không phải đoán.
4. **Trang nằm trong URL.** Màn hình giữ `?q=&offset=` (và `ioffset` khi một trang có hai danh
   sách), nên một tìm kiếm hay một trang chia sẻ được, và điều khiển hoạt động không cần JavaScript
   (`components/ui/list-controls.tsx`: `ListSearch`, `Pagination`, `pageOffset`).
5. **Màn hình chỉ cần mẫu thì xin đúng mẫu.** Dashboard và Application showcase gọi
   `{limit: RECENT_LIMIT}` — trước đây chúng tự `slice()` sau khi tải hết, tức là cắt im lặng ở
   phía trình duyệt. Không còn chỗ nào cắt dữ liệu sau khi tải.
6. **Bộ lọc cũ vẫn nguyên.** `objectKey`/`definitionKey` của instance và `windowDays` của metric
   vận hành giữ nguyên; phân trang là bổ sung, không thay thế.

## Hệ quả

- Hợp đồng đổi: năm schema danh sách thêm `total` (bắt buộc) và năm path thêm tham số. Client
  `@opvaryn/contracts` trả `Paged<T>`; mọi call site đọc `.data`, và những chỗ chỉ cần một mẫu thì
  nói rõ `limit`.
- Store dùng hai truy vấn (đếm + một trang) thay vì một truy vấn trả hết: rõ ràng hơn `count(*)
  OVER()` khi phải quét lại, và mỗi truy vấn giữ đúng bộ tham số phạm vi `$2..$4` của ADR 0008.
- `smoke-api` khẳng định cả bốn tính chất: một trang đúng bằng `limit`, `total` có sau trang,
  `offset` dịch trang, và `limit` ngoài khoảng / không phải số bị từ chối kèm lý do.
- Thêm một danh sách mới sau này phải có `limit`/`offset` và `total`; một endpoint trả cả bảng là
  lỗi thiết kế, không phải lựa chọn.
- **Ngoại lệ đã ghi nhận**: ba danh sách là *catalogue cố định*, không phải bảng dữ liệu người dùng,
  nên chúng trả về toàn bộ và có trần riêng — `GET /api/v1/roles` (vai trò có ít nhất một người giữ),
  `GET /api/v1/metrics` (định nghĩa chỉ số) và `GET /api/v1/webhook-deliveries` (nhật ký giao, có
  `limit` tối đa 200 và chỉ đọc gần đây). Một danh sách *bản ghi* mới không được theo lối này.
