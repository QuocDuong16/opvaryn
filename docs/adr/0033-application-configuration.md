# 0033 — Cấu hình của màn ứng dụng và kanban thật

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0003](0003-demo-data-slice-and-mock-surfaces.md) (màn hình mô phỏng),
  [0022](0022-administration-api-and-screens.md) (quyền quản trị),
  [0032](0032-computed-fields-and-smart-forms.md) (các loại trường của định nghĩa)

## Bối cảnh

Màn **Ứng dụng** trước đây là một phần minh hoạ: bảng kanban gom cột theo *trường lựa chọn đầu
tiên* của định nghĩa — một quy tắc không ai chọn — và tab **Cấu hình** chỉ là những ô bị khoá
với lời hứa "sẽ làm ở bản sau".

Hai điều không khớp với cách sản phẩm này làm việc: mọi thứ đọc và ghi **thật**, và mọi màn
hình nói đúng điều nó làm. Một màn hình mà nút bấm không bấm được thì phải nói là vậy — và
một quy tắc gom cột do code tự chọn thì không phải là quy tắc của tổ chức.

## Quyết định

1. **Cấu hình của màn ứng dụng được lưu**, theo từng định nghĩa dữ liệu, trong `app_configs`:
   tên hiển thị của ứng dụng, trường dùng để **gom cột kanban**, và các cột của **danh sách**.
2. **Trường gom cột phải là trường lựa chọn** và phải tồn tại trong định nghĩa. Trường không
   tồn tại, hoặc không phải lựa chọn, bị từ chối kèm lý do.
3. **Đọc cấu hình thì mở cho mọi người đã đăng nhập** — nó là hình dạng của một màn hình, không
   phải bí mật. **Ghi cấu hình thì là việc quản trị** (`admin`), và API từ chối người khác.
4. **Kanban không còn là mô phỏng**: nó gom theo đúng trường mà cấu hình chọn. Chưa có kéo thả
   giữa các cột — việc đó thuộc V2 — nhưng những gì nó hiện là thật.
5. **Danh sách hiện các cột đã cấu hình**; khi chưa cấu hình, nó rơi về các trường đầu của
   định nghĩa, và màn hình vẫn nói rõ điều đó.
6. **Tab Cấu hình không còn là ví dụ**: nó là một form lưu được, và trạng thái của nó là
   `live`.
7. **Cấu hình không có phiên bản.** Nó là cấu hình vận hành của một màn hình, không phải định
   nghĩa dữ liệu: đổi cột của danh sách không được viết lại dữ liệu. Ai sửa cấu hình thì
   được ghi vào nhật ký vận hành của API, như mọi thay đổi khác.

## Hệ quả

- Kanban và tab Cấu hình chuyển từ `mock`/`concept` sang `live`; phần còn lại của màn Ứng dụng
  (kéo thả, hành động theo vai trò, panel kết nối hai chiều) vẫn là minh hoạ và vẫn ghi nhãn.
- Cấu hình theo định nghĩa, nên hai màn hình khác nhau có thể dùng cùng một dữ liệu với hai
  hình dạng khác nhau — đó là điều một "ứng dụng" cần.
- Đổi cấu hình là việc quản trị: người dùng thường không đổi được hình dạng màn hình của nhau.
