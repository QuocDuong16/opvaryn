# 0025 — Tệp đính kèm: bytes nằm trong PostgreSQL

- **Ngày**: 2026-10-19
- **Trạng thái**: Accepted
- **Liên quan**: [0006](0006-definition-versioning.md) (bản ghi đọc theo phiên bản của nó),
  [0008](0008-identity-permissions-pilot-and-deployment.md) (phạm vi đọc, bootstrap bằng CLI),
  [0009](0009-deployment-topology-and-backup.md) (một host nội bộ, backup bằng pg_dump),
  [0023](0023-record-write-rule.md) (quy tắc ghi bản ghi)

## Bối cảnh

Kiểu trường `file` đã có trong định nghĩa từ đầu nhưng bị khoá: chưa có nơi lưu tệp. Với nghiệp vụ
pilot — đề nghị mua hàng cần báo giá, sự cố cần ảnh chụp, onboarding cần giấy tờ — thiếu tệp nghĩa
là người dùng vẫn phải gửi file qua chat và hệ thống không giữ được lịch sử.

Pilot chạy trên **một host nội bộ**, backup bằng `pg_dump` và đã có `make restore-drill` chứng minh
bản dump đọc lại được (ADR 0009). Thêm một hệ lưu trữ thứ hai (S3, MinIO, ổ đĩa) nghĩa là thêm một
thứ phải vận hành, phải sao lưu và phải diễn tập khôi phục — đúng lúc MVP cần ít bộ phận chuyển động
hơn, không phải nhiều hơn.

## Quyết định

1. **Bytes nằm trong PostgreSQL** (bảng `attachments`, cột `bytea`, trần **10 MB** mỗi tệp, có CHECK
   ở database). Nhờ vậy `make backup` và `make restore-drill` phủ luôn tệp mà không phải sửa gì.
2. **Hai bước: tải lên rồi gắn vào bản ghi.** `POST /api/v1/attachments?objectKey=…` trả về mã tệp;
   form mang mã đó trong trường `file`; khi lưu bản ghi, service gắn tệp vào đúng bản ghi và đúng
   trường **trong cùng transaction với giá trị bản ghi**. Một tệp chỉ gắn được một lần, và chỉ bởi
   người đã tải nó (hoặc quản trị hệ thống).
3. **Tải về luôn là tải xuống**: `application/octet-stream`, `Content-Disposition: attachment`,
   `X-Content-Type-Options: nosniff`. Nội dung do người dùng tải lên không bao giờ được render trong
   origin của ứng dụng. Kiểu nội dung được **nhận dạng từ bytes**, không tin lời khai của client;
   tên tệp được làm sạch (một thành phần đường dẫn, bỏ ký tự điều khiển, giới hạn độ dài).
4. **Phạm vi đọc quyết định ai tải được**: tệp chưa gắn chỉ người tải (và quản trị) thấy; tệp đã gắn
   theo phạm vi của bản ghi (ADR 0008). Không đọc được thì trả 404, không phải 403.
5. **Thay tệp là chuyện của lần lưu bản ghi**: khi sửa, tệp cũ của các trường `file` không còn được
   tham chiếu sẽ bị xoá trong cùng transaction; bỏ trống trường nghĩa là gỡ tệp. Xoá bản ghi xoá
   theo mọi tệp của nó.
6. **Rác được dọn bằng CLI**: tệp tải lên rồi bỏ dở (không bao giờ gắn) bị xoá bởi
   `make useradm ARGS="-prune-orphan-attachments"` sau 24 giờ, giống cách session hết hạn được dọn
   (ADR 0008: API không có scheduler).
7. **Điều chưa làm, có chủ ý**: không quét virus, không phiên bản hoá tệp (thay là mất bản cũ),
   không xem trước trong trình duyệt, không nhiều tệp cho một trường. Nếu yêu cầu vượt qua những
   điều này — hoặc dung lượng database thành vấn đề — thì chuyển bytes sang object storage sau cùng
   một API, và đó là một ADR mới.

## Hệ quả

- Dung lượng database và bản backup tăng theo số tệp; trần 10 MB được ép ở ba lớp (trình duyệt,
  giới hạn HTTP, CHECK của database).
- Kiểu `file` không còn bị khoá: form nhập tải tệp ngay khi chọn, hiện tên tệp, cho tải về và bỏ tệp;
  màn hình bản ghi hiển thị liên kết tải với tên tệp (ADR 0016, ADR 0018).
- `smoke-api` phủ: tải lên, gắn, tải về, phạm vi, thay tệp, xoá tệp rác; `smoke-demo-flows` phủ
  đường tải qua web. `clean-smoke-data.sh` xoá cả tệp của các object smoke.
- Bản ghi vẫn đọc theo phiên bản của nó: một bản ghi tạo khi schema chưa có trường `file` không tự
  nhiên có tệp; muốn thêm tệp cho nó phải sửa định nghĩa và tạo bản ghi theo phiên bản mới.
