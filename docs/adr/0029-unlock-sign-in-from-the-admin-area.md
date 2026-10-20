# 0029 — Mở khoá đăng nhập ngay trong khu vực quản trị

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0028](0028-login-cooldown.md) (điểm 5 của ADR này được sửa lại),
  [0022](0022-administration-api-and-screens.md) (khu vực quản trị và vai trò `admin`),
  [0008](0008-identity-permissions-pilot-and-deployment.md) (đăng nhập local)

## Bối cảnh

ADR 0028 quyết định cooldown đăng nhập (5 lần sai trong 15 phút → từ chối 15 phút) và ghi rõ ở
điểm 5: *"Không thêm endpoint mở khoá qua API: nó sẽ mở thêm một bề mặt tấn công và cần một màn
hình quản trị riêng."*

Lý do đó đúng tại thời điểm đó: khi ADR 0028 viết, sản phẩm chưa có màn hình quản trị, nên một
endpoint mở khoá sẽ chỉ là một đường CLI bọc lại, và việc thêm nó không đổi được tình huống thật:
người bị khoá vẫn phải nhờ ai đó chạy lệnh trên máy chủ.

Từ ADR 0022, khu vực **Quản trị** đã tồn tại: tài khoản, phòng ban, danh mục vai trò, đặt lại mật
khẩu và thu hồi phiên — tất cả sau `requireAdmin` trong service. Tình huống "cần một màn hình
quản trị riêng" không còn đúng: màn hình đã có, và nó là nơi một quản trị đứng để xử lý việc vậy.

## Quyết định

1. **Endpoint `POST /api/v1/admin/users/{userId}/unlock`** nằm sau `requireUser` ở biên HTTP và
   `requireAdmin` trong service, không ngoài ra. Người không có vai trò `admin` nhận 403; người
   chưa đăng nhập nhận 401.
2. **Tài khoản không tồn tại trả 404**, như mọi tài khoản khác trong khu vực quản trị. Endpoint
   không trả lời khác với một địa chỉ không có bộ đếm: nó xoá bộ đếm và trả 204, không phân biệt
   "đang khoá" với "chưa bao giờ sai".
3. **Mở khoá không đổi mật khẩu và không đụng phiên.** Nó chỉ xoá các dòng đếm sai trong
   `login_failures`. Phiên đang mở vẫn dùng được (ADR 0028, điểm 6).
4. **Màn hình cho biết ai đang chờ.** `AdminUser` mang `lockedUntil` — khoảnh khắc mà tài khoản
   đó hết bị từ chối. Danh sách tài khoản hiện nhãn, trang của một tài khoản hiện thẻ **Mở khoá
   đăng nhập**. Thẻ chỉ hiện khi tài khoản đang chờ; một nút không làm được gì thì không hiện
   (ADR 0021).
5. **CLI vẫn là đường phục hồi.** `useradm -unlock -email …` giữ nguyên vai trò: khi không còn ai
   đăng nhập được vào quản trị, đó là cách duy nhất. `useradm -list-lockouts` liệt kê các địa chỉ
   đang chờ mà không cần biết trước địa chỉ nào.
6. **Điểm 5 của ADR 0028 được sửa lại** theo hướng này. Phần còn lại của ADR 0028 — ngưỡng, câu
   trả lời không đổi, xoá bộ đếm khi thành công, bền qua restart, không đổi mô hình phiên — giữ
   nguyên.

## Hệ quả

- Bề mặt tấn công thêm là một endpoint **đã đòi hỏi phiên quản trị**. Một tài khoản quản trị bị
  chiếm vẫn có thể mở khoá cho một địa chỉ khác, nhưng không vượt qua được quyền của người đó:
  mở khoá không tạo phiên, không đổi mật khẩu và không đọc dữ liệu. Đây là mức rủi ro tương đương
  với `PUT /admin/users/{userId}/password`, vốn đã tồn tại.
- Cooldown vẫn là hàng rào chống dò mật khẩu trên **địa chỉ**, không phải trên người: nó không cản
  một kẻ tấn công đoán nhiều địa chỉ khác nhau.
- Người quản trị dùng màn hình này hằng ngày, nên nó phải đúng và phải nhanh: `lockedUntil` được
  tính từ đúng bộ đếm mà đường đăng nhập dùng, và mốc thời gian trả về là lúc tài khoản thực sự
  hết bị chặn — không phải ước lượng.
- Test phủ: service tính `lockedUntil` khớp với quy tắc chặn, mở khoá xoá đúng bộ đếm và không
  đụng tài khoản khác, người không có vai trò quản trị bị từ chối; `smoke-api` chạy đúng đường
  đăng nhập sai → có `lockedUntil` → mở khoá qua API → đăng nhập lại được, và `useradm
  -list-lockouts` thấy địa chỉ đó.
