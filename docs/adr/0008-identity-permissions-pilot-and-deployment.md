# 0008 — Identity, phân quyền, quy trình pilot và môi trường chạy

- **Ngày**: 2026-10-14
- **Trạng thái**: Accepted (mốc MVP V1)
- **Liên quan**: playbook `decisions.html` (D07, D09, D10), `index.html` (các kịch bản nghiệp vụ),
  [0005](0005-runtime-decisions-proposal.md), [0007](0007-process-execution-contract.md)

## Quyết định

| Mã | Chốt |
| --- | --- |
| **D09a** | **Local auth, thiết kế sẵn chỗ cho OIDC** — bảng users + hash mật khẩu bằng argon2id, session cookie httpOnly, admin reset mật khẩu; một lớp identity provider mỏng để OIDC cắm vào sau mà không phải đổi model user/role |
| **D09b** | **RBAC + phạm vi theo bộ phận** — quyền theo role (xem/tạo/duyệt) *và* giới hạn dữ liệu theo bộ phận của người dùng (nhân viên chỉ thấy đề nghị của bộ phận mình) |
| **D07** | **Ba quy trình pilot**: Onboarding nhân sự, Xử lý sự cố IT, Đề nghị mua hàng. Hai quy trình sau đã có object + dữ liệu mẫu; onboarding phải dựng schema và quy trình từ đầu |
| **D10** | **Một máy chủ nội bộ + Docker Compose** — API, web, PostgreSQL trên cùng host, backup `pg_dump` định kỳ, log ra file, healthcheck như hiện có |

## Hệ quả trực tiếp

### Identity (D09a)

- `users` (email chuẩn hoá, tên hiển thị, `password_hash`, `department_key`, trạng thái), `user_roles`
  (user → role), `sessions` (token **được băm** trước khi lưu, thời điểm hết hạn).
- Mật khẩu: argon2id (OWASP khuyến nghị), tham số lưu trong chính chuỗi hash để nâng được về sau;
  so sánh bằng `subtle.ConstantTimeCompare`. Không bao giờ log mật khẩu hay token.
- Đăng nhập: `POST /auth/login` → session cookie httpOnly + sameSite Lax; `POST /auth/logout` xoá
  session; `GET /me` trả người dùng hiện tại kèm role và bộ phận.
- Người dùng đầu tiên không thể tạo qua API (bài toán con gà–quả trứng): một CLI `cmd/useradm`
  tạo/đặt lại mật khẩu/gán role, dùng cho admin bootstrap và vận hành.
- **Bảo vệ runtime trước**: các endpoint runtime (`start instance`, `decide task`, và đọc instance)
  yêu cầu session, và role để quyết định task lấy từ **user đã xác thực** thay vì `actorRole` do
  client khai báo. Các trường `actorRole` và `actor` biến mất khỏi request body — đó là khoảng trống
  mà ADR 0007 đánh dấu.
- Các endpoint đọc/ghi định nghĩa (business object, process definition) **chưa** được bảo vệ trong
  bước này; chúng được ghi rõ là chưa bảo vệ trong tài liệu cho tới khi ma trận quyền được áp đủ.
  Luật: không được thêm endpoint mới nào *không* xác thực, trừ khi ADR này được cập nhật.

### Phân quyền (D09b)

- Model: `users.department_key` + `user_roles`. Quyền suy ra từ role; phạm vi dữ liệu suy ra từ bộ phận.
- Thứ tự áp dụng: (1) chặn theo role cho hành động, (2) lọc theo bộ phận cho truy vấn dữ liệu, (3)
  kiểm tra ở tầng service/store chứ không chỉ ẩn trên UI (bất biến 4 của playbook).
- Bộ phận được nhập từ dữ liệu thật của tổ chức khi pilot bắt đầu; bảng `departments` là danh mục
  đóng, không phải chuỗi tự do.

### Pilot (D07)

- **Onboarding nhân sự** cần: business object mới (ứng viên/nhân viên), quy trình nhiều bước liên
  phòng ban (HR → IT → quản lý trực tiếp), và task không chỉ là duyệt (giao việc, xác nhận hoàn tất).
- **Xử lý sự cố IT** dùng object `it_incident` sẵn có; quy trình định tuyến theo mức độ, đo được
  thời gian xử lý nhưng **SLA theo giờ làm việc** vẫn thuộc V1.x (chưa có timer).
- **Đề nghị mua hàng** dùng object `purchase_request` sẵn có; đây cũng là quy trình đã chạy trong
  smoke test nên dùng làm lát cắt tham chiếu.
- Ba quy trình này là **dữ liệu thật**: chúng cần identity, bộ phận, và quy trình đã publish trước
  khi người dùng thật chạm vào.

### Môi trường (D10)

- Docker Compose trên một host nội bộ: web, API, PostgreSQL, và (khác với local) một job backup.
- Bí mật (mật khẩu DB, session secret) đặt trong file env của host, không bao giờ trong repo.
- Restore được diễn tập ít nhất một lần trước khi pilot thật chạy — backup chưa thử restore không
  được coi là backup.
- Không có staging riêng ở giai đoạn này: pilot chạy trên một môi trường, mọi thay đổi đi qua
  `main` + CI. Khi cần staging, đó là một ADR mới.

## Việc chưa làm ở bước này (để không tự lừa mình)

- Ma trận quyền đầy đủ cho mọi endpoint (đọc/ghi định nghĩa, business object, process definition)
  và bộ lọc theo bộ phận trên tất cả truy vấn.
- Inbox theo người dùng thật (`GET /tasks` lọc theo role + bộ phận của session) và giao diện web
  dùng session cho các màn hình demo.
- OIDC: chỉ có interface, chưa có provider nào cắm vào.
- Reset mật khẩu tự phục vụ (email): hiện là thao tác của admin qua CLI.
