# 0031 — Giờ làm việc, hạn xử lý và chuyển cấp

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0007](0007-process-execution-contract.md) (hợp đồng thực thi — phần hoãn về
  timer và SLA của ADR này được thay thế trong phạm vi ghi dưới đây),
  [0011](0011-process-operational-metrics.md) (số liệu vận hành),
  [0017](0017-server-side-list-pagination.md) (danh sách phân trang ở API)

## Bối cảnh

ADR 0007 chốt runtime quy trình và **hoãn** timer, SLA, delegation và cancellation: những thứ
đó làm thay đổi bản chất của hợp đồng thực thi, nên chúng cần một ADR riêng.

Hai nhu cầu thật đã đủ để mở lại đúng một phần nhỏ của điều hoãn đó:

1. **Người nhận việc không biết hết hạn khi nào.** Một việc duyệt mà không có mốc hạn thì không
   có gì để sắp xếp — và mốc hạn tính bằng "24 giờ" thì sai: cuối tuần và ngoài giờ làm việc
   không phải thời gian ai đó chờ được.
2. **Một việc quá hạn thì không ai biết.** Khi hết hạn mà không có gì xảy ra, hệ thống im lặng
   trong khi thực tế thì việc đó rơi vào hư không.

Đây là hai điều khác nhau: **hạn xử lý** (mốc thời gian) và **chuyển cấp** (ai nhận việc khi
hết hạn). Cả hai đều cần một chính sách giờ làm việc của tổ chức, vì "hết hạn" chỉ có nghĩa
so với giờ làm việc.

## Quyết định

1. **Lịch giờ làm việc thuộc tổ chức**, lưu trong `working_hours`: mỗi ngày trong tuần có
   những khoảng (bắt đầu, kết thúc) tính bằng phút kể từ nửa đêm, theo giờ
   `Asia/Ho_Chi_Minh`. Mặc định: thứ Hai đến thứ Sáu, 09:00–17:00. Quản trị sửa ở khu vực
   Quản trị.
2. **Mỗi bước người có thể khai một hạn**: `dueInWorkingHours` — số giờ làm việc mà bước đó
   phải xong. Hạn được tính từ lúc việc được giao, **chỉ tính giờ làm việc**: một việc giao
   lúc 16:00 thứ Sáu với hạn 4 giờ làm việc hết hạn lúc 11:00 thứ Hai.
3. **Bước người có thể khai vai trò nhận việc khi quá hạn**: `escalateToRole`. Khi quá hạn mà
   bước đó có vai trò này, việc được **chuyển cấp**: việc cũ bị huỷ, một việc mới được tạo
   cho vai trò nhận, và một sự kiện `task_escalated` được ghi vào nhật ký. Lần thử
   (attempt) không đổi: đây không phải trả về.
4. **Chuyển cấp giữ nguyên mọi bất biến của ADR 0007**: quyết định vẫn chỉ được người giữ
   đúng vai trò của việc đó thực hiện; việc huỷ và việc mới cùng nằm trong **một
   transaction**, nên không có lúc nào một nút có hai việc đang mở; từ chối vẫn là kết thúc;
   trả về vẫn mở lại một lần thử mới.
5. **Việc không có hạn thì không có chuyển cấp.** Một bước không khai hạn thì không bao giờ
   quá hạn, và việc đó không bao giờ bị chuyển cấp. Việc có hạn nhưng bước không khai vai trò
   nhận thì chỉ hiện là quá hạn — hệ thống nói hết hạn, không tự ý đổi người.
6. **Hạn hiện ở hộp việc và ở màn hình của lần chạy**, kèm nhãn "quá hạn" khi đã qua. Người
   nhận việc thấy mốc hạn ngay, không phải đoán.
7. **Bộ quét chạy trong tiến trình API**, mỗi phút một lần, và chạy lại được bằng lệnh
   `useradm -escalate` cho người vận hành. Một tiến trình API không có lịch (scheduler) là
   điều đã biết; bộ quét cùng kiểu với worker gửi webhook (ADR 0012) nên không thêm kiểu
   mới.
8. **Phần hoãn của ADR 0007 vẫn hoãn**: song song/join, timer định kỳ, quy trình con, uỷ
   quyền, hủy một lần chạy giữa đường, node hành động dịch vụ, và ảnh chụp ngữ cảnh.

## Hệ quả

- Tổ chức phải nói rõ giờ làm việc của mình; mặc định (thứ Hai–thứ Sáu, 09:00–17:00) là
  một giả định, và hộp việc nói theo giờ đó.
- Hạn tính theo giờ làm việc nên phụ thuộc lịch: đổi lịch không đổi hạn đã tính cho việc đang
  mở, nhưng việc mới thì có. Đây là đánh đổi có chủ ý: lịch là điều kiện lúc giao việc.
- Việc quá hạn mà bước không khai vai trò nhận thì hệ thống chỉ báo, không chuyển. Người dùng
  phải tự quyết có chuyển hay không — việc tự ý đổi người có hậu quả thật.
- Test phủ: phép tính giờ làm việc (qua cuối tuần, qua ngày lễ, qua nhiều ngày), việc huỷ và
  việc mới cùng nằm trong một transaction, và việc không có hạn thì không bao giờ bị chuyển.
