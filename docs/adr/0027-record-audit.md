# 0027 — Lịch sử thay đổi của bản ghi

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0006](0006-definition-versioning.md) (bản ghi đọc theo phiên bản của nó),
  [0007](0007-process-execution-contract.md) (event log của quy trình),
  [0008](0008-identity-permissions-pilot-and-deployment.md) (phạm vi đọc),
  [0016](0016-display-names-instead-of-keys.md) (tên thay cho khoá),
  [0023](0023-record-write-rule.md) (quy tắc ghi bản ghi)

## Bối cảnh

Sau ADR 0023, nhiều người có thể sửa một bản ghi, nhưng bản ghi chỉ có `updated_at`: không biết
**ai** đã sửa, **trường nào**, từ giá trị nào sang giá trị nào. Với dữ liệu dùng để duyệt chi tiêu
hoặc xử lý sự cố, "hôm qua số tiền là 5 triệu, giờ là 50 triệu" là câu hỏi phải trả lời được.
Event log của quy trình chỉ ghi **quyết định**, không ghi thay đổi dữ liệu.

## Quyết định

1. **Bảng `record_audit` chỉ ghi thêm**, một dòng cho mỗi lần tạo, sửa, xoá bản ghi. Không có
   endpoint sửa hay xoá lịch sử; migration không có đường ghi đè.
2. **Ghi trong cùng transaction với thay đổi bản ghi.** Một giá trị và lịch sử của nó không thể
   lệch nhau, kể cả khi transaction rollback.
3. **Chỉ ghi những trường thực sự đổi.** Giá trị cũ và mới được so sánh theo JSON chuẩn (nên
   `[]any` từ JSONB và `[]string` sau chuẩn hoá bằng nhau). Lưu cùng một bản ghi mà không đổi gì
   thì không tạo dòng lịch sử, dù `updated_at` có đổi.
4. **Danh tính là ảnh chụp tại thời điểm đổi**: `actor_id` (có thể thành NULL nếu tài khoản bị xoá)
   và `actor_name` lưu tên lúc đó. Đổi tên hay xoá tài khoản không viết lại lịch sử.
5. **`record_id` không có khoá ngoại** để lịch sử sống lâu hơn bản ghi: xoá bản ghi không xoá
   lịch sử của nó.
6. **Đọc lịch sử dùng đúng phạm vi đọc của bản ghi** (ADR 0008): bản ghi không đọc được thì lịch
   sử trả 404, không phải 403.
7. **API trả về bản đã đọc được cho người**: nhãn trường thay cho khoá, giá trị `select` là nhãn,
   `rows` nối bằng dấu phẩy, `file` hiện "Tệp đính kèm" (không phải mã tệp). Danh sách phân trang
   (`limit`/`offset`), mới nhất trước.
8. **Màn hình bản ghi có khối "Lịch sử thay đổi"**: hành động, người thực hiện, thời điểm và từng
   dòng "Trường: cũ → mới". Không có nút sửa/xoá lịch sử.

## Hệ quả

- Mỗi lần ghi bản ghi tốn thêm một dòng; nhập CSV 500 dòng tạo 500 dòng `created`. Chưa có chính
  sách lưu trữ (retention); nếu bảng lớn, đó là một ADR riêng.
- Lịch sử không lưu tên tệp tại thời điểm đổi — chỉ biết "Tệp đính kèm" đã đổi. Muốn tên tệp trong
  lịch sử cần lưu ảnh chụp metadata; chưa làm.
- `smoke-api` phủ: tạo + sửa sinh hai mục, nhãn và giá trị `select` đúng, bản ghi ngoài phạm vi trả
  404. `smoke-demo-flows` thấy lịch sử ngay trên màn hình bản ghi sau khi sửa.
