# 0026 — Bản ghi nhập được từ CSV

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0006](0006-definition-versioning.md) (bản ghi theo phiên bản mới nhất khi tạo),
  [0008](0008-identity-permissions-pilot-and-deployment.md) (bộ phận lấy từ phiên),
  [0016](0016-display-names-instead-of-keys.md) (tên thay cho khoá),
  [0024](0024-record-csv-export.md) (xuất CSV — file mẫu)

## Bối cảnh

ADR 0024 cho dữ liệu ra Excel; nhưng dữ liệu thật thường **bắt đầu** trong Excel: danh sách nhà
cung cấp, danh mục tài sản, danh sách nhân sự chờ onboarding. Không có nhập thì người dùng phải gõ
lại từng dòng, và pilot không thể nạp dữ liệu hiện có.

Nhập khó hơn xuất vì mỗi ô là văn bản tự do: người Việt viết số `1.500.000`, ngày `01/11/2026`,
và chọn giá trị bằng **nhãn** họ thấy chứ không phải mã máy.

## Quyết định

1. **`POST /api/v1/business-objects/{key}/records/import`** nhận một file CSV (multipart), tối đa
   **5 MB** và **500 dòng dữ liệu**. Bản ghi mới được tạo theo **phiên bản đang dùng** của định
   nghĩa; nhập không sửa bản ghi cũ.
2. **Dòng đầu là tên cột.** Mỗi cột khớp với **khoá** hoặc **nhãn** của trường (không phân biệt hoa
   thường), nên file xuất CSV có thể sửa rồi nhập lại. Cột lạ, cột trùng và cột bắt buộc bị thiếu là
   lỗi ở cấp file (400), không phải lỗi từng dòng.
3. **Chuyển kiểu theo trường**, chấp nhận cách viết quen thuộc: số `1.500.000`, `12,5`,
   `1 500 000`; ngày `YYYY-MM-DD`, `DD/MM/YYYY`; `select` nhận **nhãn hoặc giá trị**; `rows` tách
   theo `;` và xuống dòng; trường `file` **không nhập được** (gắn tệp sau khi bản ghi tồn tại).
4. **Kiểm tra hết rồi mới ghi, và ghi tất cả hoặc không ghi gì.** Mỗi dòng được chuyển kiểu và
   validate như form nhập; nếu còn bất kỳ lỗi nào, không dòng nào được lưu. Kết quả trả về
   `{rows, valid, created, errors:[{row, message}]}` với `row` là **số dòng trong bảng tính**
   (dòng tiêu đề là 1) để người dùng mở file sửa đúng chỗ.
5. **`dryRun=true` chạy đúng các bước kiểm tra mà không ghi**, để nút "Kiểm tra trước" trong giao
   diện cho biết file có sạch không trước khi nhập.
6. **Giao diện** đặt khối **Nhập từ CSV** cạnh form nhập trên tab Bản ghi: chọn file, kiểm tra
   trước, rồi nhập; danh sách lỗi hiện ngay bên dưới. File xuất CSV là mẫu cột.
7. **Đây không phải công cụ đồng bộ.** Nhập luôn tạo bản ghi mới; không có khoá tự nhiên, không
   upsert, không xoá dòng vắng mặt. Muốn đồng bộ cần một quyết định riêng.

## Hệ quả

- `service/recordimport.go` là phần thuần (đọc CSV, khớp cột, chuyển kiểu, validate) và có test;
  việc ghi là `CreateObjectRecords` trong **một transaction**, kèm audit `created` cho từng bản ghi.
- `smoke-api` phủ: dry run không ghi, file có dòng sai trả lỗi theo dòng và ghi 0, nhập thật tạo
  đúng số bản ghi, số/ngày/select kiểu Việt được chấp nhận, cột lạ trả 400.
- Nhập không mang tệp: cột `file` phải để trống; người dùng gắn tệp sau (ADR 0025).
- Giới hạn 500 dòng/5 MB là có chủ ý; file lớn hơn nên chia nhỏ, và một lần nhập không giữ cả file
  trong bộ nhớ lâu hơn cần thiết.
