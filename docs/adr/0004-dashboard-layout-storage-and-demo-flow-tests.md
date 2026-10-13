# 0004 — Bố cục dashboard lưu bằng cookie, và cách kiểm thử luồng demo

- **Ngày**: 2026-10-13
- **Trạng thái**: Accepted (phạm vi bản demo)
- **Liên quan**: [0002](0002-demo-scope-and-labels.md), [0003](0003-demo-data-slice-and-mock-surfaces.md),
  playbook `demo-mvp.html` tuần 6 và tuần 8, `modules.html` mục 06

## Bối cảnh

Kế hoạch demo tuần 6 yêu cầu Analytics Studio có "grid layout và dashboard được lưu". Hai phần
của màn hình này có bản chất khác nhau: **số liệu** cần read model dựng từ event của process
instance (chưa tồn tại vì runtime chưa có — D05/D08), còn **bố cục** (widget nào, thứ tự, metric,
dimension, độ rộng) là cấu hình của người dùng và không phụ thuộc runtime.

Câu hỏi thứ hai: tuần 8 yêu cầu "test demo flows", nhưng các luồng chính của demo (nhập bản ghi,
tạo object bằng schema editor, lưu bố cục) là React server actions — `make smoke-api` chỉ chạm API,
không chạm được chúng, và môi trường này không có browser automation.

## Quyết định

1. **Bố cục dashboard là dữ liệu thật, lưu trong cookie httpOnly `opvaryn.dashboard`.** Không thêm
   bảng mới: đó sẽ là bảng cấu hình cho một tính năng chưa có identity (D09), trái tinh thần ADR
   0002/0003 ("schema đi cùng feature"). Cookie đi theo trình duyệt, cùng khuôn với theme
   (`opvaryn.theme`) và cùng cách đọc ở server để SSR đúng ngay lần vẽ đầu.
2. **Đọc thì khoan dung, ghi thì nghiêm.** `normalizeWidgets` bỏ qua entry hỏng để cookie cũ vẫn
   render; server action dùng `validateWidgetsStrict` và **từ chối** payload sai thay vì cắt bớt —
   bố cục đã lưu phải đúng bằng thứ người dùng sắp xếp. Cả hai hàm sống trong một module thuần
   (`components/analytics/dashboard-layout.ts`) và có unit test.
3. **Nhãn tách theo phần**: khối số liệu gắn `mock`, phần lưu bố cục gắn `live`. Nhãn cấp trang vẫn
   là `mock` vì phần lớn nội dung là số liệu giả lập.
4. **Luồng demo được kiểm thử tự động bằng cách replay form như trình duyệt không JavaScript**:
   `scripts/smoke-demo-flows.sh` (`make smoke-demo-flows`) build cả hai server, đọc hidden fields
   progressive-enhancement của form, POST lại, rồi kiểm chứng hai lần — qua API (dòng đã lưu chưa?)
   và qua trang render lại (người dùng có thấy không?). Không thêm dependency (Playwright) chỉ để
   chạy một lượt kiểm thử, và script tự dọn process theo PID giữ cổng.
5. **Màn hình quản trị của Application Builder là concept, có kiểm soát bị khoá.** Không làm toggle
   giả: mọi ô ở tab Cấu hình đều `disabled`, giá trị là ví dụ minh hoạ hình dạng cấu hình, kèm câu
   giải thích cần gì để thành thật (version hoá, quyền D09, audit).

## Hệ quả

- Người trình diễn có thể khoe một thứ chạy thật (bố cục lưu được, sống qua reload) mà không phải
  nói dối về số liệu, vì hai phần được gắn nhãn riêng.
- Bố cục theo cookie là **theo trình duyệt**, không theo người dùng: đổi máy là mất, và không chia
  sẻ được. Điều này phải được nói rõ khi demo; MVP chuyển sang lưu theo user/team khi có identity.
- `make smoke-demo-flows` phụ thuộc vào chi tiết của React/Next (hidden fields `$ACTION_*`). Khi
  Next nâng major, đây là chỗ dễ vỡ nhất — CI sẽ báo, và cách sửa là cập nhật script theo cách
  render mới, không phải bỏ kiểm thử.
- Script để lại object test trong database local (như `make smoke-api` để lại `smoke_*`); database
  CI là dùng một lần, còn local thì `make docker-clean` là cách dọn.
