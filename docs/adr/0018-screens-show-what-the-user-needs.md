# 0018 — Màn hình chỉ hiện thứ người dùng cần, không hiện thứ chỉ hệ thống cần

- **Ngày**: 2026-10-15
- **Trạng thái**: Accepted
- **Liên quan**: [0015](0015-role-based-surfaces-and-advanced-mode.md) (ai thấy màn hình nào),
  [0016](0016-display-names-instead-of-keys.md) (tên thay cho khoá),
  [0017](0017-server-side-list-pagination.md) (danh sách cho người đọc)

## Bối cảnh

Sau khi bỏ tên khoá khỏi các màn hình, vẫn còn một lớp thông tin chỉ hệ thống cần, nằm rải rác:
form nhập liệu in `employee_name · Văn bản · bắt buộc` dưới mỗi câu hỏi; thẻ việc in
`purchase_approval v1 · node department_approval · purchase_request`; bảng lần chạy in node key;
bảng metric in `sum(amount)` và `estimated_amount gte 20000000`; timeline in `role ke_toan ·
attempt 2`; màn Ứng dụng in `app.object.key`; các chỗ không đọc được bản ghi thì in id.

Nguyên tắc người dùng đặt ra: **giao diện phải hiện thứ người dùng cuối muốn thấy và cần thấy,
không phải thứ chỉ hệ thống mới cần thấy.**

## Quyết định

1. **Định danh hệ thống không thuộc màn hình sản phẩm.** Key của field/định nghĩa/quy trình, node
   key, id của bản ghi hay lần chạy, tên bảng — không hiện cho người dùng. Nếu cần cho việc hỗ trợ
   ("gửi tôi mã lần chạy"), hiện ở dạng phụ, nhỏ và mờ, không phải nội dung chính.
2. **Từ vựng nội bộ đổi sang lời người dùng.** `node` → **bước**, `attempt 2` → **lần 2**,
   `sum(amount)` → **Tổng của Giá trị dự kiến**, `estimated_amount gte 20000000` →
   **Giá trị dự kiến từ 20000000**, `role ke_toan` → **Kế toán**, `3 node · 2 đường chuyển` →
   **3 bước · 2 đường nối**.
3. **Không đọc được thì nói ra, đừng in id.** Một bản ghi ngoài phạm vi đọc hiện là
   "Bản ghi bạn không đọc được"; một lần chạy không có tên định nghĩa thì hiện khoá của nó (vì đó
   là sự thật duy nhất đang có) — nhưng không bao giờ hiện một chuỗi id vô nghĩa thay cho nội dung.
4. **Nhãn trạng thái build chỉ ở chế độ nâng cao.** "Chưa có trong V1", giai đoạn build, bảng
   endpoint: thuộc màn Vận hành và khối nâng cao của quản trị viên (ADR 0015).
5. **URL vẫn dùng khoá.** `/objects/purchase_request` là chuyện kỹ thuật của địa chỉ, không phải
   nội dung màn hình; đổi nó là việc khác và không cần thiết cho nguyên tắc này.
6. **Ô nhập nơi người thiết kế *chọn* khoá là ngoại lệ hợp lệ.** Khi tạo định nghĩa dữ liệu, người
   thiết kế đặt key cho field — ở đó key là thứ họ đang tạo, không phải thứ họ phải hiểu. Mọi chỗ
   khác đọc key chỉ để hiển thị đều phải đổi thành tên.

## Hệ quả

- Đợt rà này sửa: form nhập liệu (nhãn + luật bằng lời, không có key), bộ chọn loại dữ liệu, bảng
  trường của định nghĩa (bỏ cột Key), thẻ việc, bảng lần chạy, màn chi tiết một lần chạy (kể cả
  timeline: vai trò, lần, điều kiện đọc theo tên field), bảng metric ở Analytics, màn Ứng dụng, và
  các chỗ hiện id khi không đọc được bản ghi.
- `lib/names.ts` là nơi duy nhất quyết định cách đổi: `labelOrKey`, `roleLabels`, `nameLabels`,
  `fieldNames`, `joinLabels`. Timeline nhận `EventLabels` (roles + fields) để đọc payload theo tên.
- `smoke-demo-flows` khẳng định form hiện tên trường và **không** in key của trường; các assertion
  khác kiểm tên quy trình, tên loại dữ liệu và bước đang chờ thay cho khoá.
- Một màn hình mới phải trả lời được: "người dùng ở đây cần thấy gì để quyết định hoặc hành động?"
  — thứ gì chỉ để hệ thống đối chiếu thì không lên màn hình.
