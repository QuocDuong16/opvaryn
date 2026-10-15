# 0016 — Khoá máy không bao giờ hiện trên màn hình: tên hiển thị cho role và bộ phận

- **Ngày**: 2026-10-15
- **Trạng thái**: Accepted
- **Liên quan**: [0008](0008-identity-permissions-pilot-and-deployment.md) (role, bộ phận, phân quyền),
  [0015](0015-role-based-surfaces-and-advanced-mode.md) (ai thấy màn hình nào)

## Bối cảnh

Các màn hình đang in ra khoá máy: menu tài khoản ghi `ky_thuat` và
`process_designer, truong_bo_phan`; thanh trên màn Việc của tôi cũng vậy. Đó là những khoá mà
engine so sánh — hữu ích cho lập trình, vô nghĩa với người dùng, và làm sản phẩm đọc ra như một
công cụ nội bộ chưa hoàn thiện.

Bộ phận đã có sẵn tên (`departments.name`, tạo bằng `useradm -create-department -name …`). Role thì
chưa: role là khoá tự do, người thiết kế gõ vào node, không có bảng nào giữ tên.

## Quyết định

1. **Role có tên hiển thị, lưu thành dữ liệu.** Bảng `role_labels (role, label)` (migration 0009):
   khoá vẫn là thứ engine so sánh, nhãn là thứ màn hình đọc. Không nhúng bảng dịch vào code — tên
   role là chuyện của tổ chức, không phải của lập trình viên.
2. **Tên là tuỳ chọn, khoá là mặc định.** Role chưa được đặt tên vẫn hoạt động ở mọi nơi: màn hình
   hiển thị khoá thay vì giấu role đi. `labelOrKey()` trong `lib/names.ts` là quy tắc duy nhất, có
   test. Không bao giờ bịa tên từ khoá (kiểu `process_designer` → "Process designer").
3. **API trả tên, không chỉ khoá.** `GET /api/v1/me` thêm `departmentName` và `roleLabels` (map
   khoá → nhãn, chỉ gồm role người đó giữ); `GET /api/v1/roles` trả `[{key, label}]` thay vì mảng
   khoá. Quyền vẫn tính bằng khoá — tên chỉ để đọc.
4. **Chỉ quản trị viên đặt tên role** (`useradm -set-role-label`, `POST`/service `SetRoleLabel`):
   nhãn là văn bản toàn tổ chức đọc, khác với role mà người thiết kế tự gõ trên node.
5. **Màn hình gọi tên mọi thứ nó hiển thị**: quy trình hiện tên định nghĩa, bản ghi hiện nhãn của
   chính nó (theo phiên bản định nghĩa, ADR 0006), bộ phận hiện tên, role hiện nhãn. Khoá chỉ còn ở
   màn Vận hành (dành cho người vận hành) và trong các ô nhập liệu thiết kế (nơi người dùng đang
   *chọn* khoá, ví dụ trường role của node — datalist hiện tên, giá trị vẫn là khoá).

## Hệ quả

- Migration 0009 tạo `role_labels`; `scripts/seed-demo.sh` đặt tên cho các role pilot để dữ liệu mẫu
  đọc được ngay. Role của tổ chức tự đặt qua `useradm -set-role-label`.
- `lib/names.ts` (`labelOrKey`, `roleLabels`, `nameLabels`, `joinLabels`) là module thuần, có test;
  mọi màn hình đi qua nó thay vì tự nối chuỗi.
- `smoke-api` khẳng định catalogue sắp xếp theo khoá và mỗi mục đều có trường `label`;
  `smoke-demo-flows` khẳng định màn hình hiện **tên** bộ phận (không phải khoá `flow_dept_…`) và
  hiện nhãn role sau khi `useradm` đặt tên — chứng minh cả đường dữ liệu lẫn đường hiển thị.
- Từ nay thêm một trường khoá mới vào API thì phải trả kèm tên, hoặc màn hình phải nói rõ vì sao
  không có tên.
