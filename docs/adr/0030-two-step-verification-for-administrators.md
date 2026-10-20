# 0030 — Xác thực hai bước cho tài khoản quản trị

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0008](0008-identity-permissions-pilot-and-deployment.md) (đăng nhập local),
  [0022](0022-administration-api-and-screens.md) (khu vực quản trị),
  [0028](0028-login-cooldown.md) (cooldown), [0029](0029-unlock-sign-in-from-the-admin-area.md)

## Bối cảnh

Tài khoản quản trị làm được mọi thứ trong tổ chức: đọc mọi bản ghi, đặt lại mật khẩu của
người khác, cấp vai trò, xoá vai trò, mở khoá đăng nhập. ADR 0008 đã chọn đăng nhập local bằng
mật khẩu argon2id, nhưng một mật khẩu bị lộ thì tài khoản đó nắm toàn bộ.

Mật khẩu một mình không đủ với tài khoản quản trị trong một pilot nội bộ: mật khẩu bị dán vào
một ghi chú, một tin nhắn, hoặc bị nhìn thấy khi gõ. Bước thứ hai là thứ rẻ nhất để chặn điều
đó mà không cần dịch vụ ngoài.

Tổ chức chưa có IdP (ADR 0008 nói rõ OIDC là đường dành cho tương lai), nên bước thứ hai phải
làm được ngay trong sản phẩm: một mã sinh ra bằng thuật toán TOTP (RFC 6238) từ ứng dụng
xác thực trên điện thoại của chính người đó.

## Quyết định

1. **TOTP theo RFC 6238**, khoá bí mật 20 byte, bước 30 giây, mã 6 chữ số, chấp nhận lệch
   một bước (±30 giây). Mã do ứng dụng của người dùng sinh ra; máy chủ chỉ kiểm tra.
2. **Bật theo từng tài khoản, trong khu vực quản trị.** Người quản trị bật cho chính mình ở
   trang tài khoản của họ; quản trị khác có thể **bật/tắt** hai bước cho tài khoản khác. Việc
   bắt buộc mọi tài khoản quản trị bật ngay lúc này sẽ khoá chính tổ chức ra khỏi sản phẩm
   khi người dùng chưa có ứng dụng xác thực — nên nó là lựa chọn, và khu vực quản trị nói rõ
   điều đó.
3. **Khoá bí mật được mã hoá khi nằm trong cơ sở dữ liệu** bằng AES-GCM, khoá lấy từ biến môi
   trường `TOTP_ENCRYPTION_KEY` (32 byte, base64). Không có khoá thì tính năng này không bật
   được và API trả lời rõ ràng — hệ thống không âm thầm lưu khoá bí mật ở dạng rõ.
4. **Mã cứu hộ.** Khi bật, hệ thống sinh 8 mã dùng một lần, chỉ hiện đúng một lần, lưu ở dạng
   băm. Một mã cứu hộ dùng xong thì bị tiêu mất, và chỉ còn lại mã khác.
5. **Đăng nhập hai bước.** `POST /api/v1/auth/login` nhận thêm `code`. Mật khẩu sai thì trả lời
   y hệt như cũ — không nói thêm gì. Mật khẩu đúng mà thiếu mã thì trả `two_factor_required`;
   mã sai thì trả `two_factor_invalid`. Hai mã này chỉ xuất hiện **sau khi mật khẩu đã đúng**,
   nên chúng không biến đăng nhập thành công cụ dò tài khoản.
6. **Mã sai cũng bị tính vào bộ đếm cooldown** của ADR 0028. Đoán mã hai bước cũng bị chặn như
   đoán mật khẩu.
7. **Đường phục hồi.** Mất điện thoại thì quản trị khác (hoặc `useradm -reset-2fa -email …`)
   tắt hai bước cho tài khoản đó. Tài khoản bị khoá hai bước không còn bị "kẹt": hai bước là
   thêm một lớp, không phải một cái ổ khóa không mở được.
8. **Không thêm phụ thuộc mới.** TOTP và AES-GCM dùng `crypto/hmac`, `crypto/sha1` và
   `crypto/aes` của thư viện chuẩn; mã base32 viết tay (~30 dòng) và có test với bộ vectơ
   thử nghiệm của RFC 6238.

## Hệ quả

- Người quản trị phải có ứng dụng xác thực (bất kỳ ứng dụng TOTP nào) và nhập mã ở lần đăng
  nhập thứ hai. Mã nhập tay không có mã QR trong bản này: thêm thư viện QR chưa được duyệt, và
  `otpauth://` dạng chữ vẫn dùng được với mọi ứng dụng.
- `TOTP_ENCRYPTION_KEY` mới là một bí mật của hệ thống: mất nó thì phải bật lại hai bước cho
  từng tài khoản. Nó nằm cùng chỗ với các bí mật khác trong `.env` trên host.
- Mã cứu hộ phải được lưu ở nơi khác với mật khẩu — vào kho bí mật của tổ chức, không phải
  vào cùng một chỗ.
- Mã TOTP dùng lại được trong khoảng 90 giây (chấp nhận lệch một bước). Đó là đặc tính của
  TOTP: người bị đánh cắp điện thoại vẫn còn khoảng thời gian ngắn để mã bị dùng lại. Mã
  cứu hộ thì dùng một lần, và đặt lại mật khẩu cũng xoá bộ đếm.
- Bật xác thực hai bước cần JavaScript (nút tạo khoá bí mật gọi hành động máy chủ). Đăng nhập
  hai bước thì không: ô mã là một trường bình thường trong form đăng nhập.
- Test phủ: vectơ thử nghiệm RFC 6238, vòng mã hoá/giải mã, mã cứu hộ dùng một lần, và đường
  đăng nhập hai bước (thiếu mã, sai mã, đúng mã, mã cứu hộ).
