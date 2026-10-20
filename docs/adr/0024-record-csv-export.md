# 0024 — Bản ghi xuất được ra CSV

- **Ngày**: 2026-10-19
- **Trạng thái**: Accepted
- **Liên quan**: [0006](0006-definition-versioning.md) (mỗi bản ghi đọc theo phiên bản của nó),
  [0008](0008-identity-permissions-pilot-and-deployment.md) (phạm vi đọc),
  [0016](0016-display-names-instead-of-keys.md) (tên thay cho khoá),
  [0017](0017-server-side-list-pagination.md) (danh sách phân trang ở server),
  [0023](0023-record-write-rule.md) (quy tắc ghi bản ghi)

## Bối cảnh

Số liệu chỉ nằm trên màn hình. Người làm nghiệp vụ sống bằng Excel: họ cần gửi danh sách đề nghị
mua hàng cho kế toán, đối chiếu sự cố theo tuần, hoặc đơn giản là lưu lại trước khi sửa dữ liệu.
Không có cách nào mang dữ liệu ra khỏi sản phẩm ngoài việc gõ lại — điều đó khiến MVP chưa dùng
thật được.

Câu hỏi khó nằm ở chỗ định nghĩa có phiên bản (ADR 0006): bản ghi cũ mang schema cũ, nên một bảng
phẳng phải quyết định lấy schema nào. Xuất theo định nghĩa mới nhất sẽ **mất** những trường mà bản
ghi cũ có.

## Quyết định

1. **`GET /api/v1/business-objects/{key}/records/export`** trả một file CSV. Phạm vi đọc và từ khoá
   `q` giống hệt danh sách (ADR 0008): người xuất chỉ nhận được những gì họ đọc được.
2. **Cột là hợp của mọi phiên bản đã publish, phiên bản mới nhất trước.** Một trường chỉ có ở bản
   ghi cũ được nối thêm vào cuối thay vì bị bỏ; ô của phiên bản không khai báo trường đó để trống.
   Không viết lại dữ liệu cũ theo schema mới, đúng bất biến của ADR 0006.
3. **Dòng đầu là nhãn trường, không phải khoá máy** (ADR 0016). Giá trị `select` ghi ra nhãn lựa
   chọn; `rows` gộp thành một ô ngăn bằng `; `; trường `file` ghi tên tệp (một truy vấn gộp theo lô),
   không ghi mã định danh.
4. **File có BOM UTF-8** để Excel đọc đúng tiếng Việt, và **ô bắt đầu bằng `=`, `+`, `-`, `@` được
   thêm dấu nháy đơn** để giá trị đã lưu không thể trở thành công thức khi mở file. Số và ngày giữ
   nguyên dạng số/ngày.
5. **Trần 10.000 dòng.** Vượt trần trả 400 kèm câu "narrow the search"; màn hình ẩn nút tải khi
   danh sách đang xem lớn hơn trần. Một cú bấm không được kéo về một response không biên.
6. **Web tải qua route handler** `/objects/{key}/records/export`: trình duyệt không gọi thẳng API,
   route chuyển tiếp cookie phiên và stream file về (cùng lý do như mọi lời gọi khác — ADR 0008).
7. **Chưa có nhập CSV.** Nhập dữ liệu là bài toán khác (ánh xạ cột, lỗi từng dòng, giao dịch từng
   phần) và cần quyết định riêng.

## Hệ quả

- `service.encodeRecordsCSV` là hàm thuần, có test: nhãn, hợp phiên bản, nhãn lựa chọn, BOM, chống
  công thức, tên tệp.
- `smoke-api` kiểm tra: header/content-type, BOM, cột của cả hai phiên bản, nhãn `select`, phạm vi
  bộ phận (người ngoài chỉ nhận dòng tiêu đề) và từ khoá. `smoke-demo-flows` tải file qua web và mở
  bằng trình đọc CSV.
- Một file CSV là ảnh chụp tại thời điểm tải: nó không phải bản sao lưu và không được dùng thay
  `make backup`.
