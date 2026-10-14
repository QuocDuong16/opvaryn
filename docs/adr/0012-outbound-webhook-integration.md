# 0012 — Tích hợp ra ngoài: webhook có hàng đợi, retry và nhật ký giao

- **Ngày**: 2026-10-14
- **Trạng thái**: Accepted
- **Liên quan**: [0007](0007-process-execution-contract.md) (§9 và §12 xếp service action / integration vào danh sách hoãn),
  [0009](0009-deployment-topology-and-backup.md), playbook `modules.html` (Integration Hub)

## Bối cảnh

Điều kiện nghiệm thu #5 của MVP: "Có ít nhất một tích hợp API thực vận hành và xử lý lỗi rõ ràng".
ADR 0007 hoãn "service action" và "integration" khỏi engine, nên việc này cần một quyết định riêng
trước khi có code. Câu hỏi: tích hợp cái gì, chạy ở đâu, và lỗi được xử lý thế nào để không phá bất
biến "lỗi tích hợp không đảo ngược quyết định đã commit".

## Quyết định

1. **Một chiều, ra ngoài: webhook.** Khi engine làm những việc mà hệ thống khác cần biết — instance
   bắt đầu, một việc được giao, instance hoàn tất, instance bị từ chối — OPVARYN gửi một POST JSON
   tới một URL cấu hình sẵn. Đây là tích hợp thật, chạy thật, và là thứ mọi hệ thống nội bộ đều tiêu
   thụ được mà không cần viết adapter riêng.
2. **Hàng đợi trong chính database, ghi cùng transaction với sự kiện.** Mỗi lần giao là một dòng
   `webhook_deliveries` (payload, trạng thái, số lần thử, lỗi cuối) được insert **trong cùng
   transaction** với instance/task/event. Hệ quả: crash không làm mất một thông báo đã phát sinh, và
   không có hàng đợi ngoài nào phải vận hành. Dùng `FOR UPDATE SKIP LOCKED` để nhiều worker (nếu sau
   này chạy nhiều bản API) không giành nhau một dòng.
3. **Giao bất đồng bộ, có retry và backoff.** Worker trong tiến trình API quét các dòng đến hạn mỗi
   vài giây, POST với timeout ngắn, và tăng dần khoảng chờ giữa các lần thử (5s → 30s → 2m → 10m).
   Sau `OPVARYN_WEBHOOK_MAX_ATTEMPTS` lần (mặc định 5) thì trạng thái là `failed` và **không thử
   nữa** — một thông báo cũ không được phép chặn việc mới. Quyết định của người dùng **không** phụ
   thuộc vào việc giao này: giao thất bại không trả lỗi cho người duyệt và không đảo ngược gì
   (ADR 0007 §9).
4. **Chữ ký để bên nhận kiểm tra.** Mỗi request mang `X-OPVARYN-Signature: sha256=<hmac>` tính trên
   đúng body bằng `OPVARYN_WEBHOOK_SECRET`. Không có chữ ký thì bên nhận không có cách nào phân biệt
   request thật với request giả.
5. **Tắt được và không bắt buộc.** Không đặt `OPVARYN_WEBHOOK_URL` thì không có dòng nào được tạo —
   mặc định là tắt, và mọi thứ khác chạy y như cũ.
6. **Nhìn thấy được lỗi.** `GET /api/v1/webhook-deliveries` trả các lần giao gần nhất kèm trạng thái,
   số lần thử, mã HTTP và lỗi cuối; trang Cài đặt hiển thị đúng danh sách đó. "Xử lý lỗi rõ ràng"
   nghĩa là người vận hành thấy được cái gì hỏng, chứ không chỉ là code có `if err != nil`.
7. **Payload là hợp đồng.** Nội dung POST là hình dạng ổn định (event, thời điểm, instance, task nếu
   có, actor) và được ghi trong ADR này; thêm field là thay đổi tương thích ngược, đổi tên field thì
   phải là một ADR mới.

## Payload

```json
{
  "deliveryId": "uuid",
  "event": "task_created",
  "occurredAt": "2026-10-14T13:00:00Z",
  "actor": "lan@example.com",
  "instance": {
    "id": "uuid", "definitionKey": "purchase_approval", "definitionVersion": 1,
    "objectKey": "purchase_request", "recordId": "uuid",
    "state": "running", "currentNode": "approve", "attempt": 1
  },
  "task": {"id": "uuid", "nodeKey": "approve", "title": "Trưởng bộ phận duyệt", "assigneeRole": "truong_bo_phan", "attempt": 1}
}
```

## Hệ quả

- Điều kiện nghiệm thu #5 đạt bằng một tích hợp chạy thật, có retry, có chữ ký và có nhật ký — và
  được kiểm chứng end-to-end trong smoke test với một HTTP receiver thật.
- Bảng `webhook_deliveries` là bảng thứ hai ngoài mô hình engine (sau `sessions`), và nó cố ý **không**
  phải bảng process/task/event: nó là hạ tầng giao hàng, không phải trạng thái quy trình.
- Chưa có: nhiều endpoint/định tuyến theo loại sự kiện, chữ ký hai chiều, giao lại bằng tay từ UI,
  webhook vào (inbound). Khi cần, chúng là thay đổi trên cùng bảng và cùng endpoint.
- Integration Hub đầy đủ của playbook (adapter, mapping, retry policy theo adapter) vẫn là V1.x/V2:
  webhook này là lát cắt đầu tiên chứng minh đường đi.
