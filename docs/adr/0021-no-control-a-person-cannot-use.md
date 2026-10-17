# 0021 — Giao diện không mời một việc mà người dùng không làm được

- **Ngày**: 2026-10-17
- **Trạng thái**: Accepted
- **Liên quan**: [0008](0008-identity-permissions-pilot-and-deployment.md) (RBAC và phạm vi đọc),
  [0015](0015-role-based-surfaces-and-advanced-mode.md) (ai thấy màn hình nào),
  [0016](0016-display-names-instead-of-keys.md) (tên thay cho khoá),
  [0018](0018-screens-show-what-the-user-needs.md) (màn hình chỉ hiện thứ người dùng cần),
  [0019](0019-the-canvas-is-how-a-process-is-created.md) (quy trình mới vẽ trên canvas)

## Bối cảnh

ADR 0015 quyết định **màn hình** nào ai thấy: mọi người đăng nhập dùng chung các màn hình sản phẩm,
chỉ màn vận hành mới là của quản trị viên. Quyết định đó vẫn đúng, nhưng nó chưa nói gì về **nút
bấm bên trong** — và đó là chỗ hỏng: người không giữ vai trò thiết kế vẫn thấy

- mục **Tạo định nghĩa dữ liệu mới** ở `/objects`,
- khung **Sửa định nghĩa — phát hành phiên bản v2** ở `/objects/<key>`,
- nút **Tạo quy trình mới** ở `/workflows`,
- **cả trình soạn kéo thả** với **Lưu nháp** / **Phát hành phiên bản mới** ở `/workflows/<key>`,
- form **Tạo chỉ số** ở `/analytics`.

Tất cả những thứ đó API từ chối (`requireDesigner` cho tạo/sửa định nghĩa dữ liệu, quy trình và
chỉ số). Người dùng thử bằng một tài khoản không có vai trò thiết kế và hỏi thẳng: *"1 người không
có quyền tạo quy trình tại sao lại có giao diện tạo quy trình"*. Câu hỏi đúng: giao diện mời họ bỏ
công ra thiết kế một quy trình rồi mới báo là không được phép.

## Quyết định

1. **Không màn hình nào hiện một điều khiển mà người đang xem không dùng được.** Nút, form và cả
   trình soạn chỉ được render khi người đó có quyền tương ứng; chỗ trống được thay bằng một câu nói
   việc đó cần vai trò gì và ai gán được (`components/ui/role-notice.tsx`).
2. **Luật hiển thị nằm ở một chỗ**: `canDesign(roles)` (`lib/access.ts`) — `process_designer` hoặc
   `admin`, đúng như `requireDesigner` của service. Tên vai trò hiện trên màn hình là **dữ liệu**
   (`designerRoleName(catalogue)` đọc `role_labels`), khi chưa ai đặt tên thì câu văn vẫn đọc được
   như lời nói chứ không phải khoá (ADR 0016).
3. **Trình soạn quy trình trở thành chỉ-đọc với người không có quyền.** `/workflows/<key>` render
   `ProcessCanvas` (đúng sơ đồ engine đang chạy) thay vì `WorkflowEditor`, kèm câu nói rõ vì sao
   không sửa được. Nháp và phát hành không xuất hiện.
4. **Đây là quyết định hiển thị, không phải quyết định bảo mật.** API vẫn là trọng tài: mọi write
   vẫn đi qua `requireDesigner`/`requireAdmin`, và một caller gọi thẳng API vẫn bị từ chối. Giao diện
   chỉ thôi mời một việc chắc chắn thất bại.
5. **Màn hình vẫn không bị ẩn theo vai trò** (ADR 0015 giữ nguyên): người không có quyền thiết kế vẫn
   đọc được định nghĩa, quy trình, bản ghi và chỉ số — đó là nội dung của sản phẩm, không phải quyền
   của họ. Ẩn cả màn hình đi là che mất thứ họ được đọc.

## Hệ quả

- Năm chỗ đã đổi: `/objects`, `/objects/<key>` (tab Trường), `/workflows`, `/workflows/<key>`,
  `/analytics`. Mỗi chỗ hiện `DesignerNotice` với động từ đúng việc của nó ("tạo quy trình", "sửa
  định nghĩa dữ liệu", "tạo chỉ số báo cáo"…).
- `canDesign` và `designerRoleName` là hàm thuần, có test; thêm một điều khiển mới cần quyền thì
  hỏi hai hàm này, không tự đoán role.
- `smoke-demo-flows` chạy một tài khoản **không** giữ vai trò thiết kế (giám đốc của flow G) và
  khẳng định: sơ đồ vẫn đọc được, và **không** có "Phát hành phiên bản mới", "Lưu nháp", "Tạo quy
  trình mới", "Tạo định nghĩa dữ liệu mới", form tạo chỉ số — kèm câu giải thích ở mỗi màn.
- Điều khiển bị khoá vì *chưa làm được* (tab Cấu hình của Ứng dụng, ADR 0004) vẫn theo luật cũ: hiện
  ra nhưng disabled và nói rõ. Cái bị bỏ hẳn là điều khiển mà người dùng **không có quyền** — hai
  chuyện khác nhau, và màn hình phải nói đúng chuyện nào.
