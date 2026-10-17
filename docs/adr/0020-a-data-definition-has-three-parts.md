# 0020 — Một loại dữ liệu có ba phần, và một bản ghi trả lời được nó đã chạy quy trình nào

- **Ngày**: 2026-10-17
- **Trạng thái**: Accepted
- **Liên quan**: [0008](0008-identity-permissions-pilot-and-deployment.md) (phạm vi đọc theo bộ phận),
  [0011](0011-process-operational-metrics.md) (read model vận hành),
  [0016](0016-display-names-instead-of-keys.md) (tên thay cho khoá),
  [0017](0017-server-side-list-pagination.md) (danh sách phân trang ở API),
  [0018](0018-screens-show-what-the-user-needs.md) (màn hình chỉ hiện thứ người dùng cần),
  [0019](0019-the-canvas-is-how-a-process-is-created.md) (quy trình mới vẽ trên canvas)

## Bối cảnh

Trang một loại dữ liệu (`/objects/<key>`) đã lớn dần thành bốn khối xếp dọc — schema, lịch sử
phiên bản, bảng bản ghi, danh sách lần chạy — cộng hai khung bên phải (nhập bản ghi, chạy quy
trình) và một khung sửa schema. Người dùng đọc trang này và nói nó khó dùng: muốn xem một bản ghi
đã chạy quy trình nào thì không có chỗ nào trả lời, còn muốn sửa định nghĩa thì phải cuộn qua hai
bảng dữ liệu.

Danh sách lần chạy chỉ lọc được theo **loại dữ liệu** hoặc theo **quy trình**
(`GET /process-instances?objectKey=&definitionKey=`), nên câu hỏi "bản ghi này đã chạy quy trình
nào" không có cách nào trả lời đúng: màn hình chỉ có thể tải một mẫu rồi tự lọc ở trình duyệt —
đúng thứ ADR 0017 cấm.

## Quyết định

1. **Một loại dữ liệu có ba phần, mỗi lần mở một phần.** `/objects/<key>` có ba tab: **Trường**
   (các trường của phiên bản đang dùng, lịch sử phiên bản, khung sửa schema), **Bản ghi** (bảng bản
   ghi + màn nhập), **Quy trình** (khung chạy quy trình + các lần chạy). Tab mặc định là Trường —
   trang này nói về *định nghĩa* trước hết.
2. **Tab nằm trong URL** (`?tab=records`), không phải state của component: một tab là một chỗ, nên
   gửi link cho người khác được, F5 giữ nguyên, nút Back hoạt động. Giá trị lạ rơi về tab mặc định
   (`components/objects/object-tabs.ts`, thuần, có test) chứ không render ra trang trống.
3. **Mỗi tab chỉ tải thứ nó hiện.** Mở phần Trường không kéo theo bảng bản ghi. Số đếm trên thanh
   tab (số trường, số bản ghi, số lần chạy) đến từ hai lần đọc một dòng (`limit: 1` → `total`), nên
   thanh tab vẫn nói được cái gì ở đâu mà không tốn hai truy vấn đầy đủ.
4. **Một bản ghi trả lời được câu hỏi của nó.** Mỗi dòng trong bảng bản ghi có lối vào
   `?tab=processes&record=<id>`; phần Quy trình khi ấy nói rõ đang xem lần chạy của bản ghi nào, có
   nút **Bỏ lọc, xem tất cả**, và khung chạy quy trình chọn sẵn bản ghi đó.
5. **API lọc theo bản ghi.** `GET /api/v1/process-instances` nhận thêm `recordId` bên cạnh
   `objectKey`/`definitionKey`, và các bộ lọc **kết hợp** với nhau. Bộ lọc này vẫn nằm dưới đúng
   luật phạm vi đọc (ADR 0008): một bản ghi không đọc được trả về danh sách rỗng, không phải 404 —
   nó không xác nhận bản ghi đó có tồn tại. `recordId` là **id**, nên id sai bị service từ chối
   đích danh (`record_id: … is not a record id`) thay vì âm thầm trả về mọi lần chạy.

## Hệ quả

- `apps/web/components/ui/tabs.tsx` là thanh tab dùng chung (Link + `aria-current`), và
  `RecordList` chỉ hiện cột "Quy trình" khi người gọi truyền `runsHref` — một dòng không dẫn tới đâu
  là một dòng người dùng không đi tiếp được, nên màn hình nào hiện bảng bản ghi thì cũng truyền.
- Phần Quy trình **nêu tên bản ghi đang lọc khi bản ghi đó nằm trong số bản ghi màn hình đã tải** —
  đúng trường hợp người dùng bấm từ dòng của bản ghi. Khi không biết tên, câu nói là "một bản ghi"
  chứ không bịa ra tên, và nút bỏ lọc vẫn ở đó (ADR 0016).
- `smoke-demo-flows` chạy theo tab: form nhập bản ghi ở `?tab=records`, form chạy quy trình ở
  `?tab=processes` (form trả lời ở chính URL nó được render), và flow H khẳng định bộ lọc theo bản
  ghi ở cả hai phía: API trả đúng các lần chạy của bản ghi đó, và màn hình mà dòng bản ghi trỏ tới
  nói đúng điều đó.
- Trang còn dài hơn nữa thì cách xử lý là **thêm một phần**, không phải thêm một khối nữa vào cùng
  một trang. Câu hỏi phải trả lời khi thêm: phần này người dùng mở ra để làm gì?
