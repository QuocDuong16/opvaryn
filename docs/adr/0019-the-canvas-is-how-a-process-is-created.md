# 0019 — Quy trình mới được vẽ trên canvas, và checklist nói tiếng người trước khi service từ chối

- **Ngày**: 2026-10-17
- **Trạng thái**: Accepted
- **Liên quan**: [0006](0006-definition-versioning.md) (publish là bất biến),
  [0007](0007-process-execution-contract.md) (luật của graph),
  [0013](0013-canvas-draft-editing.md) (canvas sửa bản nháp),
  [0018](0018-screens-show-what-the-user-needs.md) (màn hình chỉ hiện thứ người dùng cần)

## Bối cảnh

Canvas kéo thả đã là cách **sửa** một quy trình, nhưng cách **tạo** vẫn là một biểu mẫu hàng: mỗi
bước một dòng với `Mã bước` + loại + tên, mỗi đường nối một dòng với `từ bước` / `đến bước` gõ tay.
Người dùng thử ba màn Dữ liệu / Nhập liệu / Quy trình và nói thẳng: tính năng xịn nhưng **cực kỳ khó
dùng và khó hiểu**. Đúng như vậy — để tạo một quy trình chạy được, người thiết kế phải nghĩ bằng
khoá node, tự nối các dòng với nhau, và nếu sai thì nhận lại thông báo của service dạng
`nodes[1].assigneeRole: must match ^[a-z][a-z0-9_]{1,63}$` hoặc
`nodes: at least one human_task node is required` — tiếng Anh, theo từ vựng của hệ thống.

Hai lối sửa đã cân nhắc:

- **Tạo bằng một bản mẫu đã publish sẵn** (3 field → v1 là mẫu → sửa tiếp thành v2). Ít việc nhất,
  nhưng phiên bản đầu tiên của mọi quy trình là thứ người thiết kế không vẽ, và họ phải hiểu vì sao
  quy trình mới toanh đã là v2.
- **Tạo bằng chính canvas** (mở ra với bản mẫu đã vẽ sẵn, phát hành v1 là đúng cái họ vẽ). Nhiều việc
  hơn, nhưng v1 là của họ, và chỉ có một cách hiểu quy trình: nhìn sơ đồ.

## Quyết định

1. **Tạo quy trình là vẽ trên canvas.** `/workflows` chỉ còn danh sách và một lối vào
   **Tạo quy trình mới** → `/workflows/new`. Trang tạo hỏi đúng ba câu — tên quy trình, loại dữ liệu
   nó đọc, ai nhận việc ở bước đầu tiên — rồi mở canvas với bản mẫu ba bước
   `Nhận yêu cầu → Duyệt yêu cầu → Kết thúc` (module thuần `new-definition-template.ts`). Bấm
   **Tạo và phát hành** là publish **v1 đúng bằng sơ đồ đang vẽ**; không có phiên bản mẫu nào được
   publish thay người dùng. Tạo xong thì chuyển thẳng tới `/workflows/<key>` (redirect), vì đó là chỗ
   vẽ tiếp.
2. **Biểu mẫu hàng bị xoá.** `definition-editor.tsx` và mô hình hàng của nó
   (`nodesToDrafts`/`edgesToDrafts`/`serializeGraph`…) không còn; canvas là cách duy nhất để dựng
   graph, và `definition-draft.ts` chỉ còn việc đọc `graph` mà form gửi lên.
3. **Checklist trước khi phát hành, bằng tiếng Việt** (`definition-preflight.ts`, thuần, có test):
   thiếu/đủ điểm bắt đầu, điểm kết thúc, ít nhất một bước giao cho người, bước chưa gán vai trò, mã
   vai trò không hợp lệ, bước điều kiện chưa chọn trường, số đường nối đi tiếp của từng loại bước,
   nhánh đúng/sai của bước điều kiện. Mỗi luật ở đây là **điều kiện cần** của một graph mà service
   chấp nhận, nên checklist sạch không bao giờ chặn một định nghĩa hợp lệ. Nút phát hành bị khoá khi
   checklist còn điểm, và khung bên cạnh nói còn gì để sửa.
4. **Service vẫn là trọng tài.** Checklist không phải trình kiểm tra thứ hai: chu trình, bước không
   tới được, kiểu dữ liệu của literal trong điều kiện — những thứ nó không nhìn thấy — vẫn do Go
   service từ chối ở lúc publish, và thông báo của service vẫn là thứ hiện ra cuối cùng.
5. **Canvas nói từ vựng của người dùng** (nối tiếp ADR 0018): `node` → **bước**, `field` → **trường
   dữ liệu**, `when true/false` → **nhánh đúng/sai**, `Publish phiên bản mới` → **Phát hành phiên bản
   mới**, `Instance` → **lần chạy**, `role` → **vai trò**. Chỗ chọn trường cho bước điều kiện là một
   danh sách lấy từ chính loại dữ liệu (nhãn + mã), không còn ô gõ tay mã trường; danh sách nối bước
   hiện tên bước thay vì mã bước.

## Hệ quả

- `graph-canvas.tsx` là phần dùng chung của hai chế độ: `/workflows/new` (bản nháp bắt đầu từ bản mẫu,
  chưa có gì để so sánh) và `/workflows/<key>` (bản nháp bắt đầu từ bản đã publish, có nút lưu/bỏ
  nháp và chip "có thay đổi chưa phát hành"). Canvas nhận `readiness` từ cha để khung trạng thái nói
  đúng chuyện của từng chế độ.
- Bản mẫu **không** phải là một định nghĩa đã publish: nó chỉ là bản nháp đầu tiên, nên ADR 0006
  không bị chạm tới, và engine vẫn chỉ biết những gì được publish.
- Bước giao cho người vẫn bắt buộc phải có vai trò (service đòi), nên trang tạo hỏi vai trò **trước**
  khi vẽ: một quy trình giao việc cho không ai là quy trình dừng ngay tại đó.
- Người không giữ vai trò thiết kế thấy một thẻ nói vì sao họ chưa tạo được, thay vì một biểu mẫu mà
  submit sẽ bị API từ chối.
- `smoke-demo-flows` flow H đổi theo: tạo quy trình bằng cách POST vào `/workflows/new`, và chờ **303**
  (chuyển sang trang quy trình vừa tạo) thay vì đọc thông báo thành công trên trang danh sách.
- Việc sửa tiếp vẫn như ADR 0013: bản nháp ở trình duyệt, phát hành là lần ghi duy nhất, phiên bản đã
  publish bất biến, lần chạy đang xử lý giữ phiên bản của nó.
