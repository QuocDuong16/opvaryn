# 0028 — Cooldown sau nhiều lần đăng nhập sai

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0008](0008-identity-permissions-pilot-and-deployment.md) (đăng nhập local,
  ADR này thay đổi phần "khoá tài khoản là thao tác tay"),
  [0022](0022-administration-api-and-screens.md) (quản trị tài khoản),
  [0029](0029-unlock-sign-in-from-the-admin-area.md) (sửa lại điểm 5 của ADR này)

## Bối cảnh

ADR 0008 ghi rõ: "khoá tài khoản sau nhiều lần sai hiện là thao tác của admin qua `make useradm`".
Nghĩa là không có gì cản một người (hoặc script) thử mật khẩu liên tục. Với một pilot nội bộ chứa
dữ liệu mua hàng và nhân sự, đó là lỗ hổng cơ bản.

Giới hạn theo IP không hữu ích ở topology hiện tại: API nằm sau web BFF, nên mọi request đến API
đều từ cùng một địa chỉ (web server), và `middleware.RealIP` đã bị bỏ có chủ ý vì không có thiết kế
trusted proxy. Vì vậy chính sách phải dựa trên **tài khoản**, không dựa trên IP.

## Quyết định

1. **Cooldown tạm thời, không khoá vĩnh viễn.** Sau **5 lần đăng nhập sai trong 15 phút**, địa chỉ
   đó bị từ chối đăng nhập trong **15 phút** kể từ lần sai đầu tiên của cửa sổ. Hết cửa sổ, người
   dùng đăng nhập lại bình thường.
2. **Câu trả lời không đổi.** Trong cooldown, API vẫn trả 401 `unauthorized` với cùng thông điệp
   như sai mật khẩu, và vẫn chạy một phép băm giả để thời gian phản hồi không tố cáo. Cooldown không
   được trở thành công cụ dò xem địa chỉ nào tồn tại.
3. **Đăng nhập thành công xoá bộ đếm**, và việc xoá chạy **trước khi** phiên được tạo: nếu không
   xoá được, không có phiên nửa vời nào được trả về.
4. **Bền qua restart.** Bảng `login_failures` (email, thời điểm) nằm trong PostgreSQL; khởi động
   lại API không reset một cuộc tấn công. Dòng cũ được dọn bằng CLI sau khi hết cửa sổ.
5. **Quản trị có đường mở khoá:** `make useradm ARGS="-unlock -email <address>"` xoá bộ đếm ngay;
   `-prune-login-failures` dọn các dòng cũ. ~~Không thêm endpoint mở khoá qua API: nó sẽ mở thêm một
   bề mặt tấn công và cần một màn hình quản trị riêng.~~ **[Đã sửa bởi ADR 0029](0029-unlock-sign-in-from-the-admin-area.md)**:
   khu vực quản trị đã tồn tại (ADR 0022), nên nay có cả endpoint `POST /api/v1/admin/users/{userId}/unlock`
   sau `requireAdmin`; CLI vẫn giữ vai trò đường phục hồi.
6. **Không đổi mô hình phiên.** Cooldown chặn **đăng nhập mới**; các phiên đang mở vẫn dùng được
   cho tới khi hết hạn hoặc bị thu hồi. Thu hồi phiên là việc của quản trị (ADR 0022).

## Hệ quả

- Kẻ tấn công biết một địa chỉ có thể cố ý làm người đó bị cooldown 15 phút (tấn công từ chối dịch
  vụ). Chấp nhận cho pilot: cửa sổ ngắn, người dùng có thể được mở khoá ngay bằng CLI, và đánh đổi
  này rẻ hơn việc để mật khẩu bị dò không giới hạn.
- Ngưỡng (5 lần/15 phút) là hằng số trong service; muốn cấu hình theo môi trường thì cần một quyết
  định riêng (và một chỗ đọc cấu hình).
- `login_failures` chứa địa chỉ email; đây là dữ liệu bảo mật, không phải log: không ghi ra log,
  không trả qua API, và được dọn định kỳ.
- Test service phủ: 5 lần sai chặn cả mật khẩu đúng, hết cửa sổ thì mở, thành công xoá bộ đếm, địa
  chỉ không tồn tại cũng bị đếm, CLI mở khoá. `smoke-api` chạy cùng đường với `useradm`.
