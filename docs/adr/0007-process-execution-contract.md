# 0007 — Process Execution Contract

- **Ngày**: 2026-10-13
- **Trạng thái**: Accepted (MVP V1) — thay thế điểm 2 của [ADR 0002](0002-demo-scope-and-labels.md)
  ("runtime workflow không được triển khai trong giai đoạn demo")
- **Liên quan**: playbook `architecture.html` mục 04 và 05 (năm bất biến), `decisions.html`
  (D04, D05, D08), [0005](0005-runtime-decisions-proposal.md) (các quyết định),
  [0006](0006-definition-versioning.md) (mô hình version dùng lại)

## Bối cảnh

Playbook liệt kê những gì phải được quyết trước khi viết runtime (lifecycle, activation, human
task, reject/return, concurrency, durability, side effect, versioning, auditing), và ADR 0002 đặt
điều kiện: runtime chỉ được viết sau khi hợp đồng đó tồn tại thành ADR riêng. D04/D05/D08 đã được
chủ dự án chốt (ADR 0005). ADR này là hợp đồng thực thi.

## Quyết định

### 1. Thực thể

`process_definitions` (+ `process_definition_versions` bất biến), `process_instances`,
`process_tasks`, `process_events`. Definition dùng lại đúng mô hình version của ADR 0006: tạo là
publish v1, sửa là publish phiên bản kế tiếp trong một transaction, phiên bản đã publish không bao
giờ bị sửa.

### 2. Graph của MVP

Node types: **start, human_task, condition, end**. Notification, Service Action, parallel/join,
subprocess, timer/escalation nằm ngoài MVP (playbook xếp ở "MVP tối giản/giới hạn" và V1.x).

Definition hợp lệ phải là **DAG**:

- đúng một `start`, ít nhất một `end`, ít nhất một `human_task`;
- không có chu trình — đường "làm lại" là `return` (reset), không phải vòng lặp trong graph;
- mọi node tới được từ `start`;
- `condition` có đúng hai cạnh đi ra: một `when=true`, một `when=false`;
- node khác `end` có đúng một cạnh đi ra; `start` không có cạnh đi vào; `end` không có cạnh đi ra;
- `human_task` phải có `assigneeRole` hợp lệ.

### 3. Condition (D04)

Cú pháp JSON giới hạn: `{field, op, value}` với `op ∈ {eq, ne, gt, gte, lt, lte}`.

- Kiểm tra **lúc publish**, dựa trên field definition của business object mà process gắn vào:
  field phải tồn tại; toán tử phải hợp với kiểu field (so sánh thứ tự chỉ cho number và date;
  field `rows` không được dùng trong điều kiện).
- Đánh giá **lúc chạy** trong chính transaction tiến instance, trên giá trị hiện tại của bản ghi.
- Event ghi lại **những gì điều kiện đã nhìn thấy** (`field, op, value, actual`) để audit không phải
  suy đoán.
- Đơn giản hoá có ghi chú: MVP đánh giá trên giá trị hiện tại của bản ghi, chưa phải context
  snapshot đóng băng. Snapshot thật đến khi instance không còn 1:1 với một bản ghi (V1.x).

### 4. Lifecycle

Instance: `running | completed | rejected`.

- `completed`: có đường đi tới node `end` sau khi mọi approval trên đường đó đã duyệt.
- `rejected`: một human task từ chối (terminal).
- `cancelled`/`failed` **chưa** tồn tại (chưa có endpoint huỷ, chưa có service action) nên cũng
  chưa có trong ràng buộc CHECK — thêm khi tính năng tương ứng được thêm.

Task: `open | approved | returned | rejected | cancelled`.

### 5. Activation

Instance khởi tạo từ **một phiên bản definition đã publish** + **một bản ghi đã lưu** của business
object mà process gắn vào; API từ chối nếu bản ghi thuộc object khác. Instance gắn chặt với phiên
bản tại thời điểm start; publish sau đó không đổi hành vi của instance đang chạy (bất biến 1).
Trigger của MVP là API (`POST /process-instances`); form-driven, event và schedule trigger sẽ có
ADR riêng khi được làm.

### 6. Human task (D08b)

Node `human_task` mang `assigneeRole`. Tới node này, engine tạo **một task mở cho mỗi node trong
mỗi attempt** (ràng buộc unique index), nhìn thấy được bởi mọi người có role đó. Quyết định task là
**compare-and-swap**: `UPDATE ... WHERE status = 'open'`. Người thứ hai nhận 409 và đọc được kết quả
trong timeline thay vì áp transition thứ hai (bất biến 2).

### 7. Reject / Return (D08a)

- **Từ chối**: task `rejected` (kèm lý do bắt buộc), mọi task mở khác `cancelled`, instance
  `rejected` + `finished_at`. Không gửi lại trên instance đó; lần gửi mới là instance mới.
- **Trả về**: task `returned` (lý do bắt buộc), mọi task mở khác `cancelled`, `attempt` tăng,
  instance quay lại `start` và đi tiếp, tạo task mới. Các bước đã duyệt ở attempt trước vẫn nằm
  trong event log nhưng **không** được tính là approval của attempt mới.

### 8. Tính atomic của transition

Mỗi quyết định là **một transaction**: (a) CAS trên task, (b) CAS trên instance
(`current_node`, `attempt`, `state='running'`), (c) tạo task mới nếu có, (d) ghi event. Bất kỳ CAS
nào thất bại thì cả transaction bị huỷ — không có quyết định nào áp một nửa.

### 9. Durability

State được commit trước khi trả response; response trả đúng instance đã ghi trong transaction đó.
MVP chưa có side effect ra ngoài nên **chưa có outbox**: khi node Service Action xuất hiện, nó phải
kèm bảng outbox và ADR riêng (bất biến 3: lỗi tích hợp không được đảo ngược quyết định đã commit).

### 10. Auditing

`process_events` là append-only: `instance_started`, `condition_evaluated`, `task_created`,
`task_approved`, `task_returned`, `task_rejected`, `task_cancelled`, `instance_returned`,
`instance_completed`, `instance_rejected`, kèm actor, node key và payload (lý do, điều kiện đã
đánh giá). Actor là role do caller cung cấp cho tới khi có identity (D09), sau đó là user đã xác
thực.

### 11. Phân quyền

Engine kiểm tra **role của hành động**: một task chỉ được quyết định bởi actor đang giữ đúng role mà
task được giao. Từ ADR 0008, actor đó là **user đã xác thực qua session** — request body không còn
khai báo được `actorRole`, nên không thể nhận vụ của người khác bằng cách sửa payload. Phân quyền
theo bộ phận (D09b) và ma trận quyền cho các endpoint định nghĩa vẫn là việc tiếp theo, ghi ở
ADR 0008.

### 12. Hoãn có ý thức

Parallel/join, timer/escalation/SLA, subprocess, delegation, service action/tích hợp, huỷ instance,
context snapshot, re-approval sau return — tất cả thuộc V1.x hoặc pilot, không có bảng, cột hay
endpoint nào cho chúng ở MVP.

## Hệ quả

- Migration `0004_process_runtime.sql` thêm các bảng; engine là một service (`ProcessRuntime`) trên
  đó, store chỉ đảm bảo tính atomic và các ràng buộc.
- ADR 0002 điểm 2 hết hiệu lực. Các màn hình demo còn dùng fixture (Workflows, Tasks) phải nói rõ
  "runtime đã có ở API, màn hình này còn là mô phỏng" cho tới khi UI live được làm — nói dối theo
  hướng ngược lại (như trước) cũng không được.
- `process_events` là nguồn cho read model và metric sau này (D06); metric SLA cần timer (V1.x).
- Engine được kiểm chứng bằng `make smoke-api`: start → duyệt → rẽ nhánh theo điều kiện → hoàn tất;
  return → attempt 2; reject → terminal; quyết định lần hai → 409.
