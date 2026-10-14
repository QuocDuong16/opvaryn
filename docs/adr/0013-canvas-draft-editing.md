# 0013 — Kéo thả trên canvas: bản nháp nằm ở trình duyệt, engine không bao giờ thấy

- **Ngày**: 2026-10-14
- **Trạng thái**: Accepted
- **Liên quan**: [0006](0006-definition-versioning.md) (version đã publish là bất biến),
  [0007](0007-process-execution-contract.md), [0004](0004-dashboard-layout-storage-and-demo-flow-tests.md) (cấu hình người dùng lưu bằng cookie)

## Bối cảnh

Trình thiết kế quy trình trước bước này là một biểu mẫu: node và đường chuyển nhập bằng ô nhập liệu,
canvas chỉ vẽ phiên bản đã publish. Người dùng muốn kéo thả trên canvas. Ràng buộc không được phá:
**version đã publish là bất biến** và instance đang chạy giữ version của nó (ADR 0006), nên mọi thao
tác kéo thả phải diễn ra ở một thứ *chưa* publish.

Câu hỏi: bản nháp nằm ở đâu, và publish là gì.

## Quyết định

1. **Bản nháp là của một trình duyệt, không phải của hệ thống.** Draft sống trong cookie httpOnly
   (`opvaryn.workflow_draft.<key>`) sau một server action, đúng cách bố cục dashboard được lưu
   (ADR 0004): cấu hình nhỏ, thuộc một người, không cần bảng mới, và không nằm lỏng lẻo trong
   localStorage. Engine không có API nào để đọc draft — nó chỉ biết version đã publish.
2. **Vị trí là chuyện của canvas, không phải của quy trình.** `x`/`y` chỉ tồn tại trong draft; khi
   publish, `draftGraph` bỏ chúng đi. Hệ quả: kéo node không tạo ra "thay đổi chưa publish", và
   publish một graph không sửa gì là no-op.
3. **Publish là đường ghi duy nhất.** Nút Publish gửi graph đã lắp từ draft qua đúng action cũ
   (`PUT /api/v1/process-definitions/{key}`), service kiểm tra như trước, và version mới được publish;
   draft bị xoá vì nó đã trở thành bản đã publish. Không có đường nào để draft chạm tới engine.
4. **Kiểm tra cục bộ chỉ để đỡ ngớ ngẩn.** Module thuần từ chối self-loop, đường chuyển trùng, và
   cảnh báo node việc-của-người thiếu role hay node điều kiện thiếu field. Mọi luật về graph (một
   start, đi được từ start, đủ nhánh điều kiện, literal hợp kiểu) vẫn ở service — thông báo của nó là
   thứ người dùng đọc khi publish.
5. **Bàn phím đi cùng chuột.** Node là phần tử focus được: mũi tên di chuyển, Delete xoá, và khối
   "Nối tới node khác" trong bảng bên phải nối bằng chọn thay vì kéo. Kéo thả là tiện, không phải
   đường duy nhất để sửa graph.
6. **Giới hạn có ý thức**: 40 node, 80 đường chuyển, 8 KB cookie. Vượt thì từ chối kèm lý do, không
   cắt bớt im lặng.

## Hệ quả

- Smoke test chứng minh tính chất quan trọng nhất: trong lúc một draft có thêm node tồn tại, định nghĩa
  đã publish **không đổi một byte** (so trước/sau qua API), và bỏ nháp đưa canvas về đúng bản engine
  đang chạy.
- Đánh đổi: draft không theo người qua máy khác, và hai trình duyệt có thể có hai draft khác nhau. Với
  một host nội bộ và một người thiết kế, đó là lựa chọn rẻ hơn một bảng draft + API + phân quyền; khi
  cần nhiều người cùng sửa, đó là ADR mới (và khi đó cần cả khoá lạc quan).
- Chưa có: undo/redo, copy/paste node, tự động sắp xếp lại (auto-layout) sau khi kéo, nhiều draft song
  song cho cùng một định nghĩa, và lịch sử draft. Đều là cải thiện trên cùng mô hình này.
