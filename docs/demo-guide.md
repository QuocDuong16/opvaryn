# Hướng dẫn chạy bản demo

Runbook để chạy OPVARYN Interactive Demo trên máy local và trình bày nó mà không nói quá về
phần mô phỏng. Yêu cầu cài đặt chi tiết nằm ở [README](../README.md); phạm vi và nhãn trạng thái
nằm ở [ADR 0002](adr/0002-demo-scope-and-labels.md), [ADR 0003](adr/0003-demo-data-slice-and-mock-surfaces.md)
và [ADR 0004](adr/0004-dashboard-layout-storage-and-demo-flow-tests.md).

## 1. Chuẩn bị (một lần)

Cần [mise](https://mise.jdx.dev) và Docker. Cổng dùng dải 21xxx để không đụng project khác:
web **21500**, API **21501**, PostgreSQL **21532**.

```bash
mise install                 # go 1.27.2, node 26.9.0, pnpm 12.12.0 + công cụ Go
pnpm install                 # dependency cho apps/web và packages
cp .env.example .env         # tuỳ chọn: code đã có default khớp với file mẫu
```

## 2. Chạy lần đầu với dữ liệu sạch (khuyến nghị khi trình diễn)

```bash
make docker-clean            # XOÁ volume Postgres cũ — mất toàn bộ dữ liệu local
make docker-up               # PostgreSQL 18, đợi tới khi healthy
cd apps/api && go run ./cmd/migrate && cd ../..
make dev                     # terminal 1: API :21501 + web :21500
```

Đợi tới khi terminal 1 báo API đang nghe và web ready, rồi ở **terminal 2**:

```bash
make seed-demo               # 3 business object, 3 quy trình pilot + việc đang chờ, nạp qua chính API
```

Mở http://localhost:21500. `make seed-demo` idempotent: chạy lại không tạo trùng; các instance
pilot chỉ được tạo khi role nhận việc chưa có việc nào của quy trình đó đang mở.

## 3. Chạy lại những lần sau (giữ dữ liệu)

```bash
make docker-up
cd apps/api && go run ./cmd/migrate && cd ../..   # idempotent
make dev
```

Không cần seed lại. Nếu database đang có object cũ với schema khác, `make seed-demo` sẽ cảnh báo và
bỏ qua bản ghi của object đó thay vì fail — xem mục 7.

## 4. Kiểm tra nhanh trước khi trình bày

```bash
curl -s localhost:21501/readyz        # {"status":"ok"} — API + database
curl -s localhost:21501/api/v1/meta   # tên, phiên bản, stage
```

Hai bài kiểm thử tự động (chúng tự build và tự khởi động server riêng, nên **tắt `make dev` trước**):

```bash
make smoke-api           # API + PostgreSQL: tạo, trùng key, dữ liệu sai, 404, quyền, inbox, metric, duyệt chéo role
make smoke-restart       # giết API bằng SIGKILL rồi kiểm state còn nguyên + retry trả 409, không nhân đôi side effect
make smoke-demo-flows    # build web, replay form của các luồng demo (kể cả inbox → duyệt → trả về), kiểm chứng dữ liệu lưu
```

## 5. Walkthrough 9 màn hình

Thứ tự gợi ý, kèm phần cần nói rõ để không trình bày quá:

| # | Màn hình | Nên cho xem | Nhãn |
| --- | --- | --- | --- |
| 1 | **Tổng quan** `/` | Trạng thái API/database đọc trực tiếp (không phải ảnh chụp), thẻ Walkthrough, quy ước nhãn | live |
| 2 | **Business Objects** `/objects` | Tạo object mới ngay tại chỗ: thêm vài field, một field `select` kèm danh sách lựa chọn | live |
| 3 | **Object detail** `/objects/<key>` | Form nhập liệu sinh từ schema vừa tạo; lưu một bản ghi; thử để trống field bắt buộc để thấy server chặn và báo lỗi | live |
| 3b | **Publish phiên bản** (cùng trang) | Sửa schema rồi **Publish phiên bản v2**: bản ghi cũ vẫn nằm ở nhóm "phiên bản cũ" với đúng schema cũ, bản ghi mới dùng schema mới. Đây là bất biến #1 của playbook chạy thật | live |
| 4 | **Forms** `/forms` | Đổi schema, thấy form đổi theo; danh sách "chưa có trong demo" | live + concept |
| 5 | **Workflows** `/workflows` | Danh sách định nghĩa đọc từ API; mở một định nghĩa để xem canvas của phiên bản đã publish, xem lại phiên bản cũ, và publish phiên bản mới bằng biểu mẫu. Cần role `process_designer`/`admin` mới ghi được | **live** |
| 5b | **Chạy quy trình** (trang bản ghi) | Chọn quy trình + bản ghi rồi **Chạy quy trình**: instance xuất hiện ngay trong danh sách instance của bản ghi và trong inbox của role đầu tiên | **live** |
| 6 | **Tasks** `/tasks` | Inbox thật theo role của người đang đăng nhập; mở một việc để xem bản ghi, event log và **duyệt / trả về / từ chối**; thử bằng hai tài khoản khác role để thấy việc chuyển người | **live** |
| 7 | **Analytics** `/analytics` | Metric thật trên dữ liệu thật: tạo metric từ field của object (đếm/tổng/trung bình, lọc, nhóm), thấy con số và phân rã ngay; kéo–thả sắp widget, **Lưu bố cục**, F5 để thấy còn nguyên | **live** |
| 8 | **Applications** `/apps` | Danh sách và chi tiết đọc bản ghi thật; kanban; tab **Cấu hình** (các ô đều bị khoá); panel tích hợp | live + mock + concept |
| 9 | **Roadmap** `/roadmap` | Bốn phase, điều kiện nghiệm thu MVP, quyết định đang mở chặn tiến độ và các quyết định đã chốt | concept |
| 10 | **Cài đặt** `/settings` | Danh sách endpoint, cổng, lệnh seed/smoke; **nhật ký giao webhook** (bật/tắt, số lần thử, lỗi cuối) | live |

Câu nên nói ở mục 8: "kanban và connector là mô phỏng". Nhãn `Mock` / `Concept` đã hiện sẵn ở góc
phải mỗi màn hình, nên người xem tự kiểm chứng được. Mục 6 (Tasks) và 7 (Analytics) là **live**: mọi
quyết định đi qua engine và ghi event log (người thứ hai quyết định cùng một task nhận 409), còn mỗi
con số trong dashboard là một truy vấn thật trên projection có kiểu, đúng phạm vi dữ liệu người đang
đăng nhập được đọc.

### Walkthrough màn hình Analytics (live)

1. `/analytics` hiện dashboard với các metric đang có (sau `make seed-demo` là ba metric mẫu trên dữ
   liệu thật: tổng giá trị đề nghị theo bộ phận, số đề nghị từ 20 triệu, số sự cố theo mức độ).
2. Đổi kiểu hiển thị của một widget sang **Phân rã theo nhóm** để thấy các nhóm và tỉ lệ giữa chúng;
   kéo widget để đổi thứ tự, ↑↓ cho bàn phím, **Mở rộng** để chiếm cả hai cột, **Lưu bố cục** rồi F5.
3. Tạo một metric mới: chọn object, cách tính, field đo, bộ lọc và nhóm. Thử `sum` trên một field văn
   bản để thấy service từ chối kèm lý do — không có đường nào để viết SQL.
4. Đăng nhập tài khoản bộ phận khác và mở lại cùng metric: con số khác, vì metric chạy theo phạm vi
   đọc của người đang đăng nhập (ADR 0008). Đây là điểm nên nói rõ khi trình bày.
5. Cuộn xuống mục **Vận hành quy trình**: số instance đã chạy / hoàn tất / bị từ chối / đang chạy,
   cycle time, thời gian một bước, tỉ lệ duyệt và tỉ lệ phải chạy lại — lọc theo quy trình và cửa sổ
   7/30/90/365 ngày. Đây là read model cố định trên `process_instances`/`process_tasks` (ADR 0011),
   cũng theo phạm vi đọc của bạn. **SLA chưa có** và màn hình nói thẳng như vậy: engine chưa có chính
   sách thời gian làm việc (V1.x), nên không hiển thị hạn giả.

### Walkthrough màn hình Workflows (live)

1. `/workflows` liệt kê định nghĩa đọc từ API (kèm số node và business object). Mở một định nghĩa
   (`purchase_approval` sau khi seed) để thấy canvas **vẽ graph của phiên bản đã publish** — toạ độ
   tính từ graph nên sơ đồ luôn khớp với cái engine chạy; click từng node để xem role, điều kiện và
   các đường chuyển tiếp.
2. Chọn `v1` ở dải phiên bản để thấy bản cũ vẫn xem lại được: instance đang chạy vẫn theo bản đó.
3. Sửa graph trong biểu mẫu **Publish phiên bản mới** (thêm node, đổi role, đổi literal điều kiện)
   rồi publish: bảng lịch sử có v2, canvas đổi theo, và **instance đang chạy vẫn ghi v1** — bất biến
   version chạy thật trên màn hình.
4. Graph sai (thiếu việc của người, chu trình, điều kiện sai kiểu) sẽ bị service từ chối kèm lý do
   cụ thể — thử xoá node việc của người rồi publish để thấy thông báo.
5. Muốn chạy thử: mở một bản ghi của business object tương ứng, chọn quy trình ở khung **Chạy quy
   trình** rồi bấm chạy; instance hiện ngay trong mục "Quy trình trên các bản ghi này" và việc đầu
   tiên rơi vào inbox của role tương ứng.

### Walkthrough màn hình Tasks (live)

1. Đăng nhập bằng một tài khoản có việc đang chờ (bảng tài khoản ở mục 5b). Inbox chỉ liệt kê việc
   thuộc role bạn giữ — đổi tài khoản là đổi nội dung, không có bộ lọc nào trên giao diện.
2. Mở một việc: trang instance hiện bản ghi **theo đúng phiên bản định nghĩa mà bản ghi mang**, các
   task của quy trình, và event log append-only (kể cả điều kiện đã đánh giá và giá trị nó nhìn thấy).
3. Bấm **Duyệt**: quy trình đi tiếp. Nếu nhánh điều kiện đúng, việc mới xuất hiện trong inbox của
   người giữ role kế tiếp — mở cửa sổ ẩn danh, đăng nhập tài khoản đó để chứng minh.
4. Ở bước sau, bấm **Trả về** kèm lý do: quy trình reset về điểm bắt đầu với `attempt 2`, lý do nằm
   trong timeline của người đề nghị, và task cũ vẫn còn trong lịch sử với trạng thái "đã trả về".
5. Bấm **Từ chối** (có lý do): quy trình kết thúc ở trạng thái `rejected` — terminal theo D08a.

## 5b. Đăng nhập và tài khoản demo

Mọi màn hình dữ liệu đều cần đăng nhập: session nằm trong cookie httpOnly của web app, web app
chuyển tiếp nó cho API (ADR 0008). `make seed-demo` tạo sẵn bộ tài khoản dưới đây (mật khẩu chung
`demo-password-opvaryn`), mỗi tài khoản gắn với role mà quy trình pilot giao việc:

| Tài khoản | Bộ phận | Role | Thấy gì ở `/tasks` |
| --- | --- | --- | --- |
| `seed_truong_ky_thuat@opvaryn.local` | Kỹ thuật | `nhan_vien`, `truong_bo_phan` | Đề nghị mua 9.800.000đ chờ duyệt (bước 1) |
| `seed_giam_doc@opvaryn.local` | Ban giám đốc | `giam_doc` | Đề nghị mua 52.900.000đ đã qua trưởng bộ phận, trên ngưỡng 20 triệu |
| `seed_it@opvaryn.local` | Kỹ thuật | `it_support` | Sự cố ERP nghiêm trọng chờ phân loại |
| `seed_nhan_su@opvaryn.local` | Nhân sự | `nhan_vien`, `nhan_su` | Hồ sơ onboarding chờ HR chuẩn bị |
| `seed_ke_toan@opvaryn.local` | Kế toán | `ke_toan` | (trống — chỉ nhận việc sau khi trưởng bộ phận duyệt đề nghị dưới ngưỡng) |
| `seed@opvaryn.local` | Ban giám đốc | `admin` | Tất cả dữ liệu, dùng để chứng minh phạm vi |

Tài khoản thủ công (nếu bạn tự tạo theo hướng dẫn cũ):

```bash
make useradm ARGS="-create-department -key ky_thuat -department-name 'Kỹ thuật'"
make useradm ARGS="-create -email lan@opvaryn.local -name 'Nguyễn Lan' -password demo-password-opvaryn -department ky_thuat -roles truong_bo_phan"
make useradm ARGS="-list"
```

> Mật khẩu trên chỉ dùng cho môi trường local. Trước khi cho người thật dùng: đổi mật khẩu, tạo
> tài khoản theo người thật, và đọc mục "chưa làm" trong `docs/adr/0008`.

Hai điều cần biết khi trình diễn phần này:

- **Màn hình tạo/publish định nghĩa cần role `process_designer`** (hoặc `admin`). Tài khoản
  `lan@opvaryn.local` đã có sẵn role đó; nếu bạn tự tạo tài khoản khác thì gán thêm bằng
  `make useradm ARGS="-add-role -email <email> -roles process_designer"`.
- **Bản ghi được lọc theo bộ phận**: đăng nhập `lan@opvaryn.local` (Kỹ thuật) sẽ thấy đề nghị của
  Kỹ thuật, `bao@opvaryn.local` (Kế toán) thấy 0, còn `seed@opvaryn.local` (admin) thấy tất cả. Đó
  là D09b chạy thật, không phải ẩn trên giao diện. Muốn nạp dữ liệu mẫu đúng bộ phận: `make seed-demo`.
- **Quy trình pilot** (`purchase_approval`, `incident_triage`, `hr_onboarding_flow`) đã được publish
  v1 và seed sẵn việc đang chờ; muốn xem định nghĩa thật:
  `curl -s -b /tmp/opvaryn.cookies localhost:21501/api/v1/process-definitions/purchase_approval`.

Gọi API bằng session:

```bash
curl -s -c /tmp/opvaryn.cookies -X POST localhost:21501/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"lan@opvaryn.local","password":"demo-password-opvaryn"}'
curl -s -b /tmp/opvaryn.cookies localhost:21501/api/v1/me
curl -s -b /tmp/opvaryn.cookies -X POST localhost:21501/api/v1/auth/logout
```

Không có session: `/api/v1/me`, start instance, đọc instance và quyết định task đều trả **401**;
quyết định một task mà role của bạn không giữ trả **403**.

## 6. Dừng

- `make dev`: `Ctrl+C` ở terminal 1 (dừng cả API và web).
- PostgreSQL: `make docker-down` (giữ dữ liệu) hoặc `make docker-clean` (xoá dữ liệu).

## 7. Sự cố thường gặp

| Triệu chứng | Nguyên nhân và cách xử lý |
| --- | --- |
| Tổng quan báo "API chưa sẵn sàng" | API chưa chạy hoặc chưa migrate: chạy `make dev`, và `cd apps/api && go run ./cmd/migrate` |
| `bind: address already in use` | Có process khác giữ cổng: `ss -ltnp \| grep -E ':2150[01]'` rồi `kill <pid>`. Đừng dùng `pkill -f` — pattern cũng khớp chính shell đang chạy lệnh |
| `make seed-demo` báo CẢNH BÁO schema khác | Object đã tồn tại với schema cũ nên script bỏ qua bản ghi của nó. Muốn đủ dữ liệu mẫu: `make docker-clean` rồi làm lại mục 2 |
| `make smoke-api` / `make smoke-demo-flows` báo đã có server | Hai script tự khởi động server riêng; tắt `make dev` trước |
| `/apps` hiện nhiều object lạ (`smoke_*`, `flow_*`, `qa_*`) | Rác do các lần chạy smoke test để lại; `make docker-clean` để dọn sạch |
| Danh sách role gợi ý trong trình thiết kế có `smoke_*`/`flow_*` | Tài khoản của smoke test cũng nằm trong database local, và danh mục role liệt kê role có người giữ; `make docker-clean` rồi seed lại nếu muốn sạch |
| Bố cục dashboard "mất" khi đổi máy hoặc trình duyệt | Bố cục lưu theo cookie trình duyệt, chưa theo user (ADR 0004) — đúng như thiết kế của demo |
| `pnpm install` lỗi `ERR_PNPM_IGNORED_BUILDS` | Một package mới cần build script; thêm vào `onlyBuiltDependencies` trong `pnpm-workspace.yaml` (ghi trong `mem:tech_stack`) |

## 8. Sau khi xem demo

- Phần lớn **MVP V1** đã chạy trên chính repo này (runtime, identity, inbox, thiết kế quy trình, ba
  quy trình pilot); phần còn lại và các quyết định còn mở nằm ở trang `/roadmap` trong app và
  `operations-playbook/decisions.html` — hiện chỉ **D06** (analytics) còn mở.
- Muốn chạy sản phẩm trên một host nội bộ (Docker Compose, backup, diễn tập phục hồi):
  [ops-runbook.md](ops-runbook.md).
- Muốn kiểm tra chất lượng đầy đủ trước khi commit: `make quality-check`.
