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

Mở http://localhost:21500 — đó là trang giới thiệu công khai; đăng nhập rồi mới vào workspace
(ADR 0014). `make seed-demo` idempotent: chạy lại không tạo trùng; các instance
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

## 5. Walkthrough theo thứ tự gợi ý

Thứ tự gợi ý, kèm phần cần nói rõ để không trình bày quá:

| # | Màn hình | Nên cho xem | Nhãn |
| --- | --- | --- | --- |
| 1 | **Trang giới thiệu** `/` (công khai) → **Tổng quan** `/overview` (sau đăng nhập) | Trang bìa mô tả sản phẩm cho người chưa có tài khoản; sau khi đăng nhập là trạng thái API/database đọc trực tiếp (không phải ảnh chụp), các màn hình kèm nhãn và quy ước nhãn | live |
| 2 | **Business Objects** `/objects` | Tạo object mới ngay tại chỗ: thêm vài field, một field `select` kèm danh sách lựa chọn | live |
| 3 | **Object detail** `/objects/<key>` | Ba phần, mở từng phần một: **Trường** (các trường của phiên bản đang dùng + lịch sử phiên bản + khung sửa định nghĩa), **Bản ghi** (bảng bản ghi + form nhập sinh từ định nghĩa; thử để trống trường bắt buộc để thấy server chặn), **Quy trình** (chạy một quy trình + các lần chạy). Mỗi dòng bản ghi có **Mở bản ghi** để xem/sửa/xoá trên màn hình riêng (sửa theo đúng phiên bản định nghĩa của bản ghi; bản ghi đã có lần chạy thì không xoá được) và lối vào xem riêng các lần chạy của nó. Nút **Xuất CSV** tải danh sách đang xem (tối đa 10.000 dòng) ra file mở bằng Excel; khối **Nhập từ CSV** kiểm tra file trước rồi mới ghi (tất cả hoặc không gì); trường **Báo giá** kiểu tệp cho tải tài liệu lên ngay trong form; mỗi bản ghi có **Lịch sử thay đổi** ghi ai sửa trường nào | live |
| 3b | **Phát hành phiên bản** (phần Trường) | Sửa định nghĩa rồi **Phát hành phiên bản v2**: bản ghi cũ vẫn nằm ở nhóm "phiên bản cũ" với đúng định nghĩa cũ, bản ghi mới dùng định nghĩa mới. Đây là bất biến #1 của playbook chạy thật | live |
| 4 | **Forms** `/forms` | Đổi schema, thấy form đổi theo; danh sách "chưa có trong V1" | live + concept |
| 5 | **Workflows** `/workflows` | Danh sách định nghĩa đọc từ API và lối vào **Tạo quy trình mới** (`/workflows/new`): trả lời ba câu hỏi (tên, loại dữ liệu, ai nhận việc ở bước đầu) rồi **vẽ các bước trên canvas** ngay từ đầu — bản mẫu ba bước có sẵn, checklist bên cạnh nói còn gì phải sửa trước khi phát hành. Mở một định nghĩa để **kéo thả trên canvas** (kéo bước, kéo chấm tròn để nối, thêm/xoá, sửa vai trò/điều kiện), lưu nháp rồi **Phát hành phiên bản mới**; xem lại phiên bản cũ. Cần vai trò thiết kế quy trình hoặc quản trị hệ thống mới phát hành được | **live** |
| 5b | **Chạy quy trình** (phần Quy trình) | Chọn quy trình + bản ghi rồi **Chạy quy trình**: lần chạy xuất hiện ngay trong danh sách của loại dữ liệu đó và trong hộp việc của vai trò đầu tiên. Bấm **Xem các lần chạy** ở một dòng bản ghi để chỉ xem các lần chạy của bản ghi ấy | **live** |
| 6 | **Tasks** `/tasks` | Inbox thật theo role của người đang đăng nhập; mở một việc để xem bản ghi, event log và **duyệt / trả về / từ chối**; thử bằng hai tài khoản khác role để thấy việc chuyển người | **live** |
| 7 | **Analytics** `/analytics` | Metric thật trên dữ liệu thật: tạo metric từ field của object (đếm/tổng/trung bình, lọc, nhóm), thấy con số và phân rã ngay; kéo–thả sắp widget, **Lưu bố cục**, F5 để thấy còn nguyên | **live** |
| 8 | **Applications** `/apps` | Danh sách và chi tiết đọc bản ghi thật; kanban; tab **Cấu hình** (các ô đều bị khoá); panel tích hợp | live + mock + concept |
| 9 | **Quản trị** `/admin` | Danh mục tài khoản, phòng ban, vai trò; tạo người, gán vai trò, khoá tài khoản, đặt lại mật khẩu, mở khoá đăng nhập khi tài khoản bị tạm khoá sau nhiều lần gõ sai. Chỉ tài khoản giữ vai trò quản trị hệ thống thấy khu vực này | **live** |
| 10 | **Roadmap** `/roadmap` | Bốn phase, điều kiện nghiệm thu MVP, quyết định đang mở chặn tiến độ và các quyết định đã chốt | concept |
| 11 | **Cài đặt** `/settings` | Danh sách endpoint, cổng, lệnh seed/smoke; **nhật ký giao webhook** (bật/tắt, số lần thử, lỗi cuối) | live |

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

### Walkthrough màn hình Dữ liệu (live)

1. `/objects` liệt kê các loại dữ liệu đang dùng. Bấm một loại để mở trang của nó.
2. Trang một loại dữ liệu có **ba phần**, mở từng phần một; phần đang mở nằm trong URL (`?tab=`),
   nên gửi link cho người khác được, F5 giữ nguyên và nút Back hoạt động:
   - **Trường** — các trường của phiên bản đang dùng, lịch sử phiên bản, và khung **Sửa định nghĩa —
     phát hành phiên bản v2**.
   - **Bản ghi** — bảng bản ghi (nhóm theo phiên bản) và form nhập ở khung bên phải. Mỗi dòng có
     **Xem các lần chạy →**.
   - **Quy trình** — khung **Chạy quy trình** và danh sách các lần chạy của loại dữ liệu đó.
3. Bấm **Xem các lần chạy** ở một dòng bản ghi: phần Quy trình mở ra chỉ với các lần chạy của bản
   ghi ấy, nói rõ đang xem bản ghi nào, và khung chạy quy trình chọn sẵn bản ghi đó. Nút **Bỏ lọc,
   xem tất cả** đưa về danh sách đầy đủ — đây là câu trả lời cho "bản ghi này đã chạy quy trình nào".
4. Bất biến #1 hiện ngay trên màn hình: sửa định nghĩa ở phần Trường rồi phát hành v2, quay lại phần
   Bản ghi sẽ thấy bản ghi cũ nằm riêng ở nhóm "phiên bản cũ — bản ghi giữ nguyên schema".

### Walkthrough màn hình Workflows (live)

1. `/workflows` liệt kê định nghĩa đọc từ API (kèm số bước và loại dữ liệu). Mở một định nghĩa
   (`purchase_approval` sau khi seed) để thấy canvas **vẽ sơ đồ của phiên bản đã phát hành** — toạ độ
   tính từ graph nên sơ đồ luôn khớp với cái engine chạy; bấm từng bước để xem vai trò, điều kiện và
   các đường nối đi tiếp.
2. Tạo một quy trình mới: bấm **Tạo quy trình mới** ở `/workflows`. Trang `/workflows/new` hỏi ba câu
   — tên quy trình, loại dữ liệu nó đọc, ai nhận việc ở bước đầu tiên — rồi mở canvas với bản mẫu
   `Nhận yêu cầu → Duyệt yêu cầu → Kết thúc`. Chưa chọn vai trò thì khung bên cạnh nói còn một điểm
   cần sửa và nút **Tạo và phát hành** vẫn khoá. Bấm phát hành là quy trình chạy được ngay, và màn
   hình chuyển sang trang của quy trình vừa tạo.
3. Chọn `v1` ở dải phiên bản để thấy bản cũ vẫn xem lại được: lần chạy đang xử lý vẫn theo bản đó.
4. Kéo thả trên canvas: di chuyển bước, kéo chấm tròn ở cạnh phải để nối sang bước khác, thêm bước
   mới, sửa vai trò/điều kiện ở bảng bên phải (bước điều kiện chọn trường từ danh sách của chính loại
   dữ liệu, không phải gõ mã trường). Bấm **Lưu nháp** rồi F5 — bản nháp còn nguyên, và chip chuyển
   sang "Có thay đổi chưa phát hành". **Bản nháp chỉ nằm ở trình duyệt này: mở lại định nghĩa qua API
   sẽ thấy engine vẫn đang chạy đúng bản cũ.**
5. Bấm **Phát hành phiên bản mới**: bảng lịch sử có v2, canvas đổi theo, và **lần chạy đang xử lý vẫn
   ghi v1** — bất biến version chạy thật trên màn hình. Nút **Bỏ nháp** đưa sơ đồ về đúng bản engine
   đang chạy.
6. Sơ đồ sai thì có hai lớp nói ra: checklist bên cạnh canvas chỉ đúng chỗ còn thiếu bằng tiếng Việt
   và giữ nút phát hành khoá (thiếu bước giao cho người, bước chưa gán vai trò, bước điều kiện chưa
   chọn trường…); những gì nó không thấy — chu trình, bước không tới được, điều kiện sai kiểu — do
   service từ chối kèm lý do cụ thể. Thử xoá bước giao cho người rồi xem cả hai.
7. Muốn chạy thử: mở một bản ghi của loại dữ liệu tương ứng, chọn quy trình ở khung **Chạy quy
   trình** rồi bấm chạy; lần chạy hiện ngay trong mục "Quy trình trên các bản ghi này" và việc đầu
   tiên rơi vào hộp việc của vai trò tương ứng.

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

Tài khoản thủ công: `useradm` vẫn là đường bootstrap cho tài khoản quản trị đầu tiên. Sau đó, tạo
và quản lý tài khoản, phòng ban, vai trò ngay trong sản phẩm tại **Quản trị** `/admin` (ADR 0022).

```bash
make useradm ARGS="-create-department -key ky_thuat -department-name 'Kỹ thuật'"
make useradm ARGS="-create -email lan@opvaryn.local -name 'Nguyễn Lan' -password demo-password-opvaryn -department ky_thuat -roles truong_bo_phan"
make useradm ARGS="-list"
```

> Mật khẩu trên chỉ dùng cho môi trường local. Trước khi cho người thật dùng: đổi mật khẩu, tạo
> tài khoản theo người thật, và đọc mục "chưa làm" trong `docs/adr/0008`.

Hai điều cần biết khi trình diễn phần này:

- **Tạo và sửa định nghĩa, quy trình, chỉ số cần role `process_designer`** (hoặc `admin`). Tài
  khoản `lan@opvaryn.local` đã có sẵn role đó; nếu bạn tự tạo tài khoản khác thì gán thêm bằng
  `make useradm ARGS="-add-role -email <email> -roles process_designer"`. Người **không** giữ vai
  trò đó không thấy các nút tạo/sửa (kể cả trình soạn quy trình — họ chỉ đọc sơ đồ), và mỗi màn
  nói rõ việc đó cần vai trò gì; API vẫn là nơi từ chối thật (ADR 0021).
- **Bản ghi được lọc theo bộ phận**: đăng nhập `lan@opvaryn.local` (Kỹ thuật) sẽ thấy đề nghị của
  Kỹ thuật, `seed_ke_toan@opvaryn.local` (Kế toán) thấy 0, còn `seed@opvaryn.local` (admin) thấy tất cả. Đó
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
  quy trình pilot); phần còn lại nằm ở trang `/roadmap` trong app. Các quyết định trong playbook
  (**D04–D10**) đã chốt hết và chạy trong code — xem `docs/adr/`.
- Muốn chạy sản phẩm trên một host nội bộ (Docker Compose, backup, diễn tập phục hồi):
  [ops-runbook.md](ops-runbook.md).
- Muốn kiểm tra chất lượng đầy đủ trước khi commit: `make quality-check`.
