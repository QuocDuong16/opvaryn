# 0037 — Tra cứu hai chiều: ghi ngược hệ thống ngoài

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0034](0034-external-lookup.md) (tra cứu một chiều),
  [0012](0012-outbound-webhook-integration.md) (hàng đợi, thử lại, chữ ký),
  [0027](0027-record-audit.md) (lịch sử thay đổi),
  [0023](0023-record-write-rule.md) (ai được sửa bản ghi)

## Bối cảnh

ADR 0034 cho phép một trường lựa chọn lấy danh sách của mình từ hệ thống khác: danh mục
nhà cung cấp trong hệ thống mua hàng, danh sách nhân viên trong hệ thống nhân sự. Chiều đọc
đã chạy, nhưng chiều ghi thì chưa: OPVARYN biết mình đang chọn mã `sup-01` của nhà cung cấp
`Công ty Một`, còn hệ thống mua hàng thì không hề biết bản ghi này tồn tại. Người dùng
phải vào hai hệ thống mà làm cùng một việc.

Trang giới thiệu có ghi "tra cứu hai chiều" như một thứ chưa có, và chỗ chưa có là **mô hình
đồng bộ**: ghi ngược lúc nào, gửi cái gì, xử lý xung đột thế nào khi hai bên cùng sửa một
bản ghi. Không chốt được mô hình thì không viết code, vì mỗi lựa chọn khác nhau sẽ dẫn tới
một hệ thống khác hẳn.

Ba mô hình đã được cân nhắc:

1. **Ghi đồng bộ** — người lưu bản ghi bị chặn cho tới khi hệ thống ngoài nhận. Đơn giản về
   logic, nhưng một hệ thống ngoài chết là cả nhóm người không lưu được bản ghi; và thời gian
   chờ của hệ thống ngoài nằm trong đường ghi của người dùng.
2. **Ghi bất đồng bộ, có hàng đợi và thử lại** — bản ghi được lưu trước, việc ghi ngược
   được xếp hàng và gửi sau bởi một worker.
3. **Một bên là nguồn sự thật** — hoặc OPVARYN, hoặc hệ thống ngoài là nơi duy nhất được sửa;
   bên kia chỉ đọc. Không có ghi ngược, nhưng cũng không phải "hai chiều".

Đã chọn **mô hình 2**.

## Quyết định

1. **Ghi ngược bất đồng bộ, hàng đợi nằm trong database, ghi cùng transaction với bản ghi.**
   Mỗi lần ghi ngược là một dòng `lookup_writebacks` được insert **trong cùng transaction**
   với việc tạo/sửa bản ghi. Hệ quả: crash không làm mất một lần ghi đã phát sinh, và việc
   hệ thống ngoài đang chậm hay chết **không** làm hỏng việc lưu bản ghi của người dùng.
   Worker chạy trong tiến trình API, lấy hàng đợi bằng `FOR UPDATE SKIP LOCKED` — cùng cách
   làm như webhook của ADR 0012, nên không có dịch vụ thứ ba phải vận hành.

2. **Bật ghi ngược theo từng nguồn tra cứu.** Một nguồn tra cứu có thêm hai phần cấu hình:
   `write_url` (nơi ghi) và `write_fields` (những trường được gửi đi). Không có `write_url`
   thì nguồn đó chỉ đọc, đúng như hôm nay. Đây là việc quản trị, làm ở khu vực Quản trị
   (tab **Tra cứu ngoài**), cùng chỗ gắn nguồn.

3. **Khi nào ghi.** Bản ghi được **tạo** → ghi ngược cho mỗi nguồn có bật. Bản ghi được
   **sửa** → chỉ ghi ngược nếu một trường trong `write_fields` thực sự đổi giá trị; sửa một
   trường khác thì hệ thống ngoài không cần biết. **Xóa bản ghi thì không ghi ngược** —
   nằm ngoài phạm vi lần này, và hệ thống ngoài tự có kênh của nó.

4. **Payload là hợp đồng.** Mỗi lần gửi là một POST JSON:

   ```json
   {
     "deliveryId": "uuid",
     "occurredAt": "2026-10-20T09:15:00Z",
     "action": "created",
     "actor": {"id": "uuid", "name": "Lan"},
     "object": {"key": "don_mua_hang", "version": 3},
     "record": {"id": "uuid"},
     "field": "supplier",
     "values": {"supplier": "sup-01", "amount": 15000000}
   }
   ```

   `values` chỉ chứa những trường của `write_fields`. Đổi tên field là đổi hợp đồng, nên nó
   phải là một ADR mới.

5. **Hệ thống ngoài trả lời được, và câu trả lời có hai phần.**

   ```json
   {"accepted": true, "values": {"amount": 15000000}}
   ```

   - `accepted: false` → hệ thống ngoài **từ chối** có chủ đích: lần ghi đó thành
     `rejected`, **không thử lại**, và lý do được ghi lại.
   - `values` là **bản sửa**: những giá trị hệ thống ngoài muốn đặt lại.

6. **Quy tắc xung đột: bản ghi chưa đổi thì mới sửa được.** Mỗi lần ghi mang theo thời
   điểm `updated_at` của bản ghi lúc nó được xếp hàng. Khi áp dụng bản sửa, câu lệnh cập nhật
   **có điều kiện** theo thời điểm đó: nếu bản ghi đã được ai đó sửa trong lúc chờ, dòng cập
   nhật không chạm được dòng nào, lần ghi thành `conflict`, **không ghi đè công việc của
   người**, và người vận hành thấy nó trong nhật ký để xử lý. Đây là điểm cốt lõi của mô hình
   hai chiều: OPVARYN không bao giờ thắng người dùng một cách âm thầm.

7. **Bản sửa chỉ được sửa đúng những trường đã gửi đi.** Hệ thống ngoài sửa một trường mà
   OPVARYN không gửi thì lần ghi thành `conflict` — không có đường để một bên tự ý thêm dữ
   liệu vào bản ghi của bên kia.

8. **Bản sửa được áp dụng thì nó là một lần ghi bản ghi bình thường**: qua cùng đường kiểm
   tra giá trị, cùng phép chiếu có kiểu, cùng nhật ký thay đổi (ADR 0027) — với tác giả là
   chính nguồn ngoài, nên người đọc lịch sử của bản ghi thấy "ai đã sửa". Bản sửa **không** được
   ghi ngược lần nữa: nếu không, một bản sửa đẽ sinh ra một bản sửa mới, vô hạn.

9. **Chữ ký và nhật ký giao.** Mỗi request mang `X-OPVARYN-Signature: sha256=<hmac>` trên
   đúng body, tính bằng `OPVARYN_WEBHOOK_SECRET` — cùng bí mật với webhook ra ngoài, vì đây
   là cùng một loại tích hợp ra ngoài và không muốn một bí mật thứ hai phải nằm trong cấu
   hình. `X-OPVARYN-Delivery` mang mã lần ghi để bên nhận chống gửi trùng.

10. **Lỗi phải nhìn thấy được.** `GET /api/v1/admin/lookups/writebacks` trả các lần ghi
    gần đây kèm trạng thái (`pending`, `delivered`, `failed`, `conflict`, `rejected`), số lần
    thử, mã HTTP và lỗi cuối; tab **Tra cứu ngoài** hiển thị đúng danh sách đó. Một lần ghi
    hỏng không được chỉ nằm trong một `if err != nil`.

11. **Thử lại rồi bỏ.** Lỗi giao (hệ thống ngoài trả lỗi hoặc không trả lời) được thử lại với
    khoảng chờ tăng dần (5s → 30s → 2m → 10m). Sau `OPVARYN_LOOKUP_MAX_ATTEMPTS` lần (mặc
    định 5) lần ghi thành `failed` và **không thử nữa** — một lần ghi cũ không được chặn việc
    mới.

12. **Chốt chặn địa chỉ nội bộ như tra cứu đọc.** Địa chỉ ghi ngược cũng phải qua bộ lọc
    SSRF của ADR 0034 (không gọi vào mạng nội bộ, không theo chuyển hướng). Một tổ chức có
    hệ thống ngoài nằm trong mạng riêng của họ bật `OPVARYN_LOOKUP_ALLOW_INTERNAL=1` — mặc
    định tắt.

## Hệ quả

- Tra cứu trở thành tra cứu **hai chiều**: hệ thống ngoài biết bản ghi của OPVARYN, và
  OPVARYN nhận được bản sửa của hệ thống ngoài — nhưng chỉ khi bản ghi chưa ai sửa trong
  lúc chờ.
- Người dùng không bao giờ bị chặn bởi hệ thống ngoài: bản ghi được lưu trước, ghi ngược
  xếp hàng sau.
- Hai bảng mới? Không: `lookup_writebacks` là hạ tầng giao hàng, cùng loại với
  `webhook_deliveries` của ADR 0012, và nó không tham gia vào mô hình quy trình.
- Xung đột không tự giải quyết: nó được **báo ra** (trạng thái `conflict` trong nhật ký) để
  người vận hành quyết định. Một mô hình "hợp nhất tự động" sẽ cần một bản ghi hợp nhất và
  chính sách thắng/thua cho từng trường — việc đó chưa chốt.
- Xóa bản ghi không ghi ngược, và việc kéo dữ liệu về (poll) từ hệ thống ngoài vẫn chưa có:
  chiều đọc của ADR 0034 vẫn là "danh sách lựa chọn lấy lúc mở màn hình", chưa phải dữ liệu
  được đồng bộ liên tục.
