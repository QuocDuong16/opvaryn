# 0036 — Cột bảng có kiểu, ô công thức đo được, hộp việc xếp theo ưu tiên

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0010](0010-analytics-query-builder.md) (projection có kiểu, chỉ số),
  [0011](0011-process-operational-metrics.md) (số liệu vận hành),
  [0031](0031-working-hours-and-due-dates.md) (hạn xử lý),
  [0032](0032-computed-fields-and-smart-forms.md) (ô công thức, bảng dòng lặp),
  [0035](0035-work-policies.md) (chính sách việc)

## Bối cảnh

Ba khoảng trống còn lại sau khi làm xong Form Builder, cấu hình ứng dụng, tra cứu ngoài và
chính sách việc:

1. **Bảng chỉ có cột chữ.** Định nghĩa đã có `FieldColumn.type` và máy chủ đã kiểm tra ô
   theo cột, nhưng trình soạn tạo ra cột kiểu chữ và không có cách chọn kiểu khác. Người
   dùng không phân biệt được "số" với "chữ", nên không được đo và không được cộng.
2. **Ô công thức không đo được.** Giá trị tính được lưu trong bản ghi nhưng không vào
   projection, nên `kindForField` từ chối và một chỉ số không thể đo ô công thức — đúng cái
   lý do ô công thức được thêm vào.
3. **Hộp việc không xếp theo ưu tiên.** Ưu tiên đã có (ADR 0035) và hộp việc đã hiện nhãn,
   nhưng danh sách vẫn xếp theo thời điểm tạo: việc khẩn nằm dưới việc thường.

Đọc code cũng lộ ra hai lỗi nghiêm trọng:

- `toAPIFieldDefinitions` **không** trả `formula`, `visibleWhen`, `columns`. Mở một định nghĩa
  cũ để phát hành phiên bản tiếp theo là âm thầm xoá công thức, điều kiện hiển thị và cột
  bảng.
- Tokenizer của biểu thức **không nhận `&` và `|`**, nên `&&` và `||` (có trong ADR 0032) viết
  được trong tài liệu nhưng không dùng được trong thực tế.

## Quyết định

1. **Một cột của bảng có kiểu: chữ, số hoặc ngày.** Trình soạn cho chọn kiểu từng cột;
   máy chủ kiểm tra ô theo kiểu cột (đã có) và **chuẩn hoá** ô về đúng kiểu trước khi lưu: cột
   số lưu số, cột ngày lưu chuỗi `YYYY-MM-DD`, cột chữ lưu chữ đã cắt khoảng trắng.
2. **Ô của bảng có phép chiếu riêng.** `record_table_values` giữ một dòng cho mỗi ô: trường
   bảng, cột, số thứ tự dòng và giá trị trong cột theo kiểu của nó. Bảng có nhiều dòng nên
   không vừa vào `record_field_values` (một dòng cho mỗi trường). Phép chiếu được ghi trong
   **cùng transaction** với bản ghi, và tìm kiếm bản ghi đọc nó, nên tìm trong một bảng tìm
   thấy cả ô chữ lẫn ô số.
3. **Một chỉ số có thể đo một cột của bảng.** Chỉ số giữ `field_key` (trường bảng) và
   `field_column` (cột trong đó). Chỉ cột **số** mới đo được. Khi đo một cột, "số bản ghi" là
   số bản ghi **khác nhau** (`count(DISTINCT r.id)`), vì một bản ghi có nhiều dòng.
4. **Một ô công thức luôn cho ra một số.** Kiểu của biểu thức được **đọc từ biểu thức**, không
   cần bản ghi nào tồn tại: phép tính và hàm cho ra số, phép so sánh và toán tử logic cho ra
   đúng/sai. Vì vậy một ô công thức chỉ được phát hành khi biểu thức cho ra số; một so sánh
   phải nằm trong một lựa chọn (`điều kiện ? 1 : 0`). Ô công thức được chiếu như trường số,
   nên **một chỉ số đo được ô công thức**.
5. **Một điều kiện hiển thị không đọc ô công thức.** Ô công thức chỉ có giá trị sau khi lưu,
   nên điều kiện đọc nó sẽ không bao giờ đúng — và trường sẽ biến mất mà không báo lỗi. Máy
   chủ từ chối lúc phát hành.
6. **Hộp việc xếp: khẩn nhất trước, rồi sắp đến hạn, rồi cũ nhất.** Ưu tiên là chữ nên được
   xếp hạng tường minh (`urgent` → `high` → `normal` → `low`), không xếp theo chữ. Việc không có
   hạn nằm sau việc có hạn.
7. **Sửa hai lỗi nói trên.** `toAPIFieldDefinitions` trả lại đủ công thức, điều kiện hiển thị và
   cột; tokenizer nhận `&&` và `||`.

## Hệ quả

- Một cột kiểu "số" bây giờ có nghĩa: ô nhập vào là ô nhập số, giá trị lưu là số, tìm kiếm
  thấy nó, và một chỉ số cộng được nó.
- Một ô công thức trở thành một trường số thật sự: nó được đo, được nhóm theo quy tắc của
  trường số, và giá trị của nó xuất hiện trong báo cáo.
- Một bảng có nhiều dòng không còn là "một giá trị", nên nó **không** đo được như một trường:
  chỉ cột của nó mới đo được. Người thiết kế phải nói rõ mình đo cột nào.
- Việc dùng `&&`/`||` trong biểu thức giờ mới thật sự dùng được.
- Phép chiếu ô bảng làm bản ghi nặng hơn một chút khi ghi (một INSERT cho mỗi ô), đổi lại
  không có truy vấn nào phải đọc JSONB, và tìm kiếm thấy được nội dung của bảng.
- Test phủ: kiểu của biểu thức, ô công thức bị từ chối khi không cho ra số, điều kiện đọc ô
  công thức bị từ chối, phép chiếu ô bảng theo kiểu cột, chỉ số đo cột bảng và từ chối cột
  không đo được.
