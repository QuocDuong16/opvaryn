# 0023 — Một bản ghi có màn hình riêng, sửa và xoá được theo quy tắc ghi

- **Ngày**: 2026-10-19
- **Trạng thái**: Accepted
- **Liên quan**: [0006](0006-definition-versioning.md) (bản ghi đọc theo phiên bản của nó),
  [0007](0007-process-execution-contract.md) (điều kiện đọc giá trị hiện tại của bản ghi),
  [0008](0008-identity-permissions-pilot-and-deployment.md) (phạm vi đọc theo bộ phận),
  [0016](0016-display-names-instead-of-keys.md) (tên thay cho khoá),
  [0018](0018-screens-show-what-the-user-needs.md) (màn hình chỉ hiện thứ người dùng cần),
  [0021](0021-no-control-a-person-cannot-use.md) (không mời việc API sẽ từ chối)

## Bối cảnh

Bản ghi chỉ có hai thao tác: tạo và đọc. Một người nhập sai số tiền, chọn nhầm mức ưu tiên
hoặc gõ sai tên — không có cách nào sửa; bản ghi sai nằm lại mãi và mọi báo cáo đọc nó.
Cũng không có màn hình cho **một** bản ghi: danh sách chỉ có bảng và liên kết tới các lần chạy.
Với một sản phẩm đem ra dùng, đó là lỗ hổng lớn hơn mọi chi tiết giao diện.

Câu hỏi kèm theo là **ai được sửa**. Phạm vi đọc của ADR 0008 rộng hơn người nhập: người duyệt
ở bộ phận khác đọc được bản ghi qua việc đang chờ họ. Nếu cho họ sửa, người duyệt có thể viết
lại chính đề nghị mình đang duyệt. Điều đó không được phép.

## Quyết định

1. **Ba endpoint cho một bản ghi**: `GET`, `PUT`, `DELETE`
   `/api/v1/business-objects/{key}/records/{recordId}`. Đọc dùng đúng phạm vi của danh sách;
   bản ghi ngoài phạm vi trả **404**, không phải 403, để API không xác nhận bản ghi đó tồn tại.
2. **Quy tắc ghi hẹp hơn quy tắc đọc**: được sửa/xoá khi là **quản trị hệ thống**, **người đã
   tạo bản ghi**, hoặc **người cùng bộ phận với bản ghi**. Người chỉ đọc được qua một việc đang
   chờ (người duyệt khác bộ phận) **không** sửa được: họ quyết định đề nghị, không viết lại nó.
3. **Sửa là thay giá trị, không phải phát hành phiên bản.** Giá trị mới được validate theo
   **đúng phiên bản định nghĩa mà bản ghi được tạo theo** (ADR 0006 invariant 1), chuẩn hoá như
   lúc tạo, rồi ghi lại cùng projection có kiểu trong **một transaction** để chỉ số và bản ghi
   không bao giờ lệch nhau. Object, phiên bản và người tạo không đổi; `updated_at` đổi.
4. **Xoá chỉ khi bản ghi chưa từng chạy quy trình.** Có instance tham chiếu thì trả **409
   `in_use`**: các lần chạy và nhật ký quyết định là lịch sử, xoá bản ghi sẽ kéo theo lịch sử
   đó. Bản ghi đã có lần chạy được giữ lại, kể cả khi người tạo muốn xoá.
5. **Mỗi bản ghi có màn hình riêng** (`/objects/{key}/records/{recordId}`): giá trị đọc theo
   phiên bản của nó, người nhập, bộ phận, phiên bản, thời điểm tạo/cập nhật, lối vào các lần
   chạy; form sửa cho người có quyền và nút xoá kèm xác nhận. Danh sách có liên kết **Mở bản
   ghi** trên từng dòng.
6. **API trả `canEdit` cho mỗi bản ghi** để giao diện không mời một việc chắc chắn bị từ chối
   (ADR 0021). Đây chỉ là gợi ý hiển thị: mọi lần ghi vẫn kiểm tra lại ở service.
7. **Chưa có audit từng trường của lần sửa.** `updated_at` ghi nhận bản ghi đã đổi; nhật ký
   quyết định vẫn là `process_events`. Muốn biết "ai đổi trường nào từ giá trị nào" cần một
   bảng audit riêng và một ADR khác.

## Hệ quả

- Hợp đồng có thêm ba operation, `ObjectRecord` có thêm `canEdit`, `createdByName`,
  `departmentName` (tên hiển thị, không phải khoá — ADR 0016).
- Store: `FindVisibleObjectRecord` (đọc có phạm vi), `FindBusinessObjectVersion` (schema của
  bản ghi), `UpdateObjectRecord` (giá trị + projection trong một transaction),
  `DeleteObjectRecord` (chặn khi có instance).
- `POST /process-instances` cũng dùng `FindVisibleObjectRecord`: trước đây một người biết UUID
  của bản ghi ngoài phạm vi vẫn khởi chạy được quy trình trên nó. Giờ bản ghi không đọc được
  trả lời y như bản ghi không tồn tại.
- Test: service test cho phạm vi đọc, quy tắc ghi, validate theo phiên bản cũ và chặn xoá;
  `smoke-api` phủ đọc/sửa/xoá qua HTTP; `smoke-demo-flows` mở bản ghi, sửa qua form thật, xoá
  bản ghi tạm và kiểm chứng lại qua API.
- Tệp đính kèm vẫn chưa có: trường `file` tiếp tục bị khoá với câu giải thích. Đó là việc của
  một ADR về lưu trữ tệp, không phải của quy tắc ghi này.
