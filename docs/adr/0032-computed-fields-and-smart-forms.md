# 0032 — Ô công thức, điều kiện hiển thị và bảng dòng lặp

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0006](0006-definition-versioning.md) (định nghĩa có phiên bản),
  [0007](0007-process-execution-contract.md) (điều kiện của quy trình),
  [0010](0010-analytics-query-builder.md) (read model có kiểu)

## Bối cảnh

Form Builder từ đầu chỉ có các loại trường nhập tay: văn bản, số, ngày, lựa chọn, tệp, và một
danh sách dòng chữ. Ba nhu cầu thật chưa được đáp ứng:

1. **Ô công thức.** Người dùng phải tự tính "số lượng × đơn giá" rồi gõ kết quả vào một ô
   khác. Số liệu sai là lỗi không ai bắt được.
2. **Điều kiện hiển thị.** Một biểu mẫu có mười trường, nhưng người dùng chỉ cần ba ô khi
   đơn nhỏ. Ô nào không liên quan thì nên ẩn, và dữ liệu của ô ẩn không nên nằm trong bản ghi.
3. **Bảng dòng lặp.** "Danh sách dòng" hiện là mỗi dòng một mục chữ — không đo được, không
   cộng được, và bảng báo cáo không lấy ra được.

## Quyết định

1. **Trường `formula`**: giá trị của nó do hệ thống tính, người dùng không nhập và không sửa.
   Biểu thức là ngôn ngữ nhỏ, **không phải mã**: một số, một tên trường của cùng mẫu, các
   phép `+ − × ÷`, ngoặc, so sánh (`= ≠ > ≥ < ≤`), `&&`, `||`, và một lựa chọn
   `điều kiện ? có : không`. Hàm: `ROUND`, `ABS`, `MIN`, `MAX`.
   Biểu thức được **phân tích thành cây rồi duyệt**, không bao giờ được `eval`: một định
   nghĩa không thể chạy thứ nó không nên chạy.
2. **Công thức chỉ đọc trường số** của cùng mẫu, không đọc chính nó, và mọi trường nó đọc
   phải tồn tại trong mẫu — kiểm tra lúc phát hành phiên bản.
3. **Giá trị tính ở lúc ghi**, trong cùng transaction với bản ghi. Số người dùng gửi lên
   trường công thức bị bỏ qua: máy chủ là nguồn sự thật.
4. **Trường `visibleWhen`**: điều kiện cùng dạng với điều kiện của bước quy trình
   (`trường`, `phép so sánh`, `giá trị`). Khi điều kiện không đúng, trường **không hiện** và
   **giá trị của nó không được lưu**; nó cũng không bắt buộc nhập.
5. **Trường `table`**: một danh sách dòng, mỗi dòng là một tập ô có kiểu theo các cột mà
   người thiết kế khai. Ô sai kiểu bị từ chối kèm tên cột.
6. **Cùng một quy tắc ở hai nơi**: server quyết định cái được lưu, trình duyệt quyết định cái
   được hiện. Hai bên dùng chung một cách hiểu điều kiện, nên form không bao giờ hiện một ô
   mà bản ghi sẽ không nhận.

## Hệ quả

- Người dùng không còn phải tự tính, và số liệu tính tay sai không còn lọt qua.
- Biểu thức là một ngôn ngữ nhỏ: người thiết kế phải học nó. Đổi lại, mọi biểu thức đều
  **kiểm tra được** và không thể làm hỏng hệ thống.
- Một trường công thức không dùng được cho trường văn bản: phép tính cần số. Muốn ghép
  chuỗi thì phải làm ở chỗ khác.
- Bảng là loại trường mới: mã báo cáo và tích hợp đọc nó như một danh sách dòng có cột, nên
  phần đo lường phải biết cột đó thuộc loại nào.
- Test phủ: vectơ của biểu thức (số học, ngoặc, so sánh, hàm, biểu thức hỏng), luật ẩn/hiện
  theo điều kiện, và ô bảng sai kiểu.
