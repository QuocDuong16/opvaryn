# 0022 — Quản trị tổ chức: API và màn hình cho người dùng, phòng ban, vai trò

- **Ngày**: 2026-10-19
- **Trạng thái**: Accepted
- **Liên quan**: [0006](0006-definition-versioning.md) (phiên bản bất biến),
  [0007](0007-process-execution-contract.md) (vai trò trên node quy trình),
  [0008](0008-identity-permissions-pilot-and-deployment.md) (RBAC, phạm vi bộ phận, bootstrap),
  [0015](0015-role-based-surfaces-and-advanced-mode.md) (ai thấy màn hình nào),
  [0016](0016-display-names-instead-of-keys.md) (tên thay cho khoá),
  [0017](0017-server-side-list-pagination.md) (danh sách phân trang ở server),
  [0021](0021-no-control-a-person-cannot-use.md) (không mời việc API sẽ từ chối)

## Bối cảnh

ADR 0008 chốt: tài khoản và bộ phận chỉ tạo được bằng CLI `cmd/useradm`, vì tài khoản quản trị đầu
tiên không thể đến từ API (bài toán con gà–quả trứng). Điều đó đúng cho bootstrap nhưng để lại một lỗ
hổng vận hành: sau khi pilot chạy, mọi thay đổi tài khoản — thêm người, đổi phòng ban, gán vai trò,
đặt lại mật khẩu — đều phải qua terminal trên server. Không có màn hình nào cho việc quản trị cơ bản;
`/settings` chỉ là trang vận hành kỹ thuật, và chính nó ghi rõ "cấu hình tổ chức chưa có trong bản
này".

Vai trò cũng chưa phải dữ liệu: một role tồn tại chừng nào còn người giữ nó (`user_roles`), tên hiển
thị nằm ở bảng `role_labels`. Không thể tạo một vai trò trước rồi mới gán người, không thể biết vai
trò nào đang được quy trình dùng, và không thể thu hồi vai trò.

## Quyết định

1. **Thêm API quản trị `/api/v1/admin/*`** cho người dùng, phòng ban và vai trò, chỉ người giữ vai
   trò `admin` gọi được (`requireAdmin` trong `internal/service/admin.go`). Mọi luật nằm ở service,
   không ở giao diện (invariant 4 của ADR 0008).
2. **Vai trò trở thành danh mục có thật** (bảng `roles`: key, label, `is_system`, `created_at`).
   `role_labels` được gộp vào đây và bảng cũ bị xoá bằng migration 0010. Một vai trò có thể được tạo
   trước khi có người giữ; khi CLI gán một vai trò mới, nó tự vào danh mục. Hai vai trò hệ thống
   (`admin`, `process_designer`) luôn tồn tại, đổi tên được nhưng không xoá được.
3. **Quản lý người dùng đầy đủ trong phạm vi không phá lịch sử**: tạo, sửa tên/email/phòng ban, thay
   toàn bộ tập vai trò, khoá/mở tài khoản, đặt lại mật khẩu và đăng xuất mọi phiên. Không có xoá
   cứng — bản ghi, sự kiện quy trình và phiên đã gắn với con người đó; khoá tài khoản là cách thu hồi.
   Đặt lại mật khẩu cũng kết thúc mọi phiên (một lần đặt lại là một lần thu hồi tài khoản).
4. **Các ràng buộc an toàn được ép ở store, trong transaction:**
   - Không thể khoá tài khoản đang đăng nhập (service) và không thể để tổ chức hết quản trị viên
     đang hoạt động; `UpdateUser` giữ một advisory lock khi kiểm tra, nên hai lần hạ quyền đồng thời
     không thể cùng lọt.
   - Không xoá phòng ban còn người thuộc về nó; phòng ban đang là phạm vi của bản ghi cũng bị từ chối,
     vì xoá đi sẽ âm thầm đổi ai đọc được những bản ghi đó.
   - Không xoá vai trò hệ thống, vai trò còn người giữ, hoặc vai trò được một phiên bản quy trình đã
     publish nhắc tới (phiên bản là bất biến, ADR 0006/0007).
   - Lỗi "còn phụ thuộc" mang mã `in_use` (409) khác với `conflict` (trùng khoá), để màn hình nói
     đúng chuyện.
5. **Khu vực `/admin` trên web** gồm bốn màn hình: tổng quan kèm cách phân quyền hoạt động, Người
   dùng (danh sách + chi tiết), Phòng ban, Vai trò. Người không giữ vai trò quản trị nhận 404, đúng
   quy ước ADR 0015. Danh sách phân trang và tìm kiếm ở server (ADR 0017); mọi chỗ hiện tên thay cho
   khoá, trừ ô nhập nơi người thiết kế đang chọn khoá (ADR 0016, ADR 0018).
6. **Bổ sung ADR 0015**: màn hình quản trị tổ chức là việc sản phẩm, nên hiện cho người quản trị
   **không cần** bật chế độ nâng cao; chỉ `/settings` và `/roadmap` (mô tả cách hệ thống được dựng và
   vận hành) mới cần chế độ nâng cao.
7. **Mô hình quyền vẫn cố định.** Khu vực này quản lý *ai giữ vai trò nào*, không tạo ma trận quyền
   tuỳ ý. Các luật cố định (`admin`, `process_designer`, vai trò theo bước, phạm vi bộ phận) vẫn nằm
   trong `internal/service/authz.go` và từng service; trang tổng quan nói rõ điều đó thay vì hứa một
   thứ chưa có.
8. **Bootstrap không đổi**: tài khoản quản trị đầu tiên vẫn tạo bằng `make useradm` (ADR 0008). CLI
   vẫn dùng được cho mọi thao tác cũ; nó là đường phục hồi khi không còn ai đăng nhập được.

## Hệ quả

- Hợp đồng có thêm 14 operation dưới tag `administration`, ba nhóm schema (`AdminUser`, `AdminDepartment`,
  `AdminRole`) và response `Forbidden`; `make contract-generate` sinh lại Go và TypeScript.
- `apps/api/internal/service/admin_test.go` kiểm tra: người không phải admin bị từ chối ở mọi nhóm,
  validate tạo người, không tự khoá tài khoản, thay tập vai trò, đặt mật khẩu thu hồi phiên, validate
  phòng ban/vai trò.
- `scripts/smoke-api.sh` mở rộng thêm luồng quản trị end-to-end: tạo phòng ban, tạo vai trò, tạo
  người, sửa, đặt mật khẩu (phiên cũ chết), gán vai trò, từ chối xoá khi còn phụ thuộc, 403 cho người
  không phải admin.
- Bảng `role_labels` biến mất; `ListRoles`/`ListRoleLabels` đọc từ `roles`. `useradm -set-role-label`
  giữ nguyên hành vi nhưng ghi vào danh mục mới.
- Xoá vai trò có thể bị từ chối vì một phiên bản quy trình cũ vẫn dùng nó. Đó là hệ quả có chủ ý của
  bất biến phiên bản: sửa một định nghĩa cũ để xoá được một vai trò là điều không được phép.
