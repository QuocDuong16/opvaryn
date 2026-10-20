# 0035 — Chính sách việc: mức ưu tiên và hạn riêng theo loại việc

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0031](0031-working-hours-and-due-dates.md) (giờ làm việc, hạn xử lý, chuyển cấp —
  ADR này mở rộng nó), [0022](0022-administration-api-and-screens.md) (quyền quản trị)

## Bối cảnh

ADR 0031 đưa giờ làm việc, hạn xử lý và chuyển cấp vào sản phẩm. Nhưng hạn thì **mọi bước
dùng chung một cách tính**: số giờ làm việc khai trên chính bước.

Điều đó không đúng với thực tế: một đề nghị mua hàng và một sự cố IT không có cùng một đồng
hồ, và "gấp" của một việc này không có nghĩa "gấp" của việc kia. Người quản trị cũng cần nói
được việc nào quan trọng hơn việc nào.

## Quyết định

1. **Chính sách việc thuộc loại việc** (tức là loại dữ liệu), lưu trong `work_policies`:
   hạn mặc định (tính bằng giờ làm việc), mức ưu tiên mặc định
   (`thấp` / `bình thường` / `cao` / `khẩn`), và vai trò nhận việc khi quá hạn.
2. **Bước của quy trình vẫn được khai riêng** (`dueInWorkingHours`, `escalateToRole` của ADR 0031,
   và nay thêm `priority`). **Khai của bước thắng chính sách**: một quy trình có thể có bước
   gấp trong khi loại việc của nó bình thường.
3. **Ưu tiên đi theo việc**, được ghi vào `process_tasks.priority` lúc tạo, nên hộp việc hiện
   nó được và một lần đo có thể gom theo nó.
4. **Đọc chính sách thì mở cho mọi người đã đăng nhập**; **ghi thì là việc quản trị**, ở khu
   vực Quản trị (tab **Chính sách việc**).
5. **Vai trò chuyển cấp trong chính sách** là vai trò nhận việc khi quá hạn khi bước không tự
   khai. Bước tự khai thì dùng vai trò của bước.

## Hệ quả

- Hai loại việc có hai đồng hồ khác nhau, và người quản trị đặt được trong một màn hình.
- Ưu tiên là dữ liệu của việc, không phải của bước: nó đi theo việc tới nơi việc đi.
- Chính sách không có phiên bản: nó là quy ước vận hành, không phải dữ liệu. Đổi hạn mặc định
  không viết lại việc đang mở — những việc đó giữ hạn của lúc chúng được tạo.
