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
make seed-demo               # 2 business object mẫu + 9 bản ghi, nạp qua chính API
```

Mở http://localhost:21500. `make seed-demo` idempotent: chạy lại không tạo trùng.

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
make smoke-api           # API + PostgreSQL: tạo, trùng key, dữ liệu sai, 404
make smoke-demo-flows    # build web, replay form của các luồng demo, kiểm chứng dữ liệu lưu
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
| 5 | **Workflows** `/workflows` | Sơ đồ hai quy trình, click từng node xem cấu hình và nhánh điều kiện — preview thiết kế; engine thật nằm ở API | **mock** |
| 6 | **Tasks** `/tasks` | Duyệt / trả về / từ chối, timeline đổi theo; người giữ việc — màn hình dùng fixture, engine duyệt thật đã có ở API | **mock** |
| 7 | **Analytics** `/analytics` | Kéo–thả sắp widget, đổi metric/dimension, **Lưu bố cục**, rồi F5 để thấy bố cục còn nguyên | số liệu **mock**, bố cục **live** |
| 8 | **Applications** `/apps` | Danh sách và chi tiết đọc bản ghi thật; kanban; tab **Cấu hình** (các ô đều bị khoá); panel tích hợp | live + mock + concept |
| 9 | **Roadmap** `/roadmap` | Bốn phase, điều kiện nghiệm thu MVP, các quyết định đang mở chặn tiến độ | concept |
| 10 | **Cài đặt** `/settings` | Danh sách endpoint, cổng, lệnh seed/smoke — tiện để chứng minh dữ liệu thật bằng curl | live |

Câu nên nói ở mục 5, 6, 7, 8: "phần này là mô phỏng vì workflow runtime chưa được viết — nó chờ
quyết định D05/D08 trong playbook". Nhãn `Mock` / `Concept` đã hiện sẵn ở góc phải mỗi màn hình, nên
người xem tự kiểm chứng được.

## 5b. Đăng nhập (identity đã có, UI chưa nối)

Runtime quy trình yêu cầu đăng nhập. Màn hình demo hiện **chưa** dùng session — chúng vẫn là
fixture — nên buổi trình diễn UI không bị ảnh hưởng; phần cần session là API.

Tạo bộ phận và tài khoản (chạy một lần, sau khi đã migrate):

```bash
make useradm ARGS="-create-department -key ky_thuat -department-name 'Kỹ thuật'"
make useradm ARGS="-create-department -key ke_toan -department-name 'Kế toán'"
make useradm ARGS="-create -email lan@opvaryn.local -name 'Nguyễn Lan' -password demo-password-opvaryn -department ky_thuat -roles truong_bo_phan"
make useradm ARGS="-create -email bao@opvaryn.local -name 'Trần Bảo' -password demo-password-opvaryn -department ke_toan -roles ke_toan"
make useradm ARGS="-list"
```

> Mật khẩu trên chỉ dùng cho môi trường local. Trước khi cho người thật dùng: đổi mật khẩu, tạo
> tài khoản theo người thật, và đọc mục "chưa bảo vệ" trong `docs/adr/0008`.

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
| Bố cục dashboard "mất" khi đổi máy hoặc trình duyệt | Bố cục lưu theo cookie trình duyệt, chưa theo user (ADR 0004) — đúng như thiết kế của demo |
| `pnpm install` lỗi `ERR_PNPM_IGNORED_BUILDS` | Một package mới cần build script; thêm vào `onlyBuiltDependencies` trong `pnpm-workspace.yaml` (ghi trong `mem:tech_stack`) |

## 8. Sau khi xem demo

- Mốc tiếp theo là **MVP V1** (20–30 tuần theo playbook) và nó bị chặn một phần bởi các quyết định
  còn mở (D04–D10) — xem trang `/roadmap` trong app hoặc `operations-playbook/decisions.html`.
- Muốn kiểm tra chất lượng đầy đủ trước khi commit: `make quality-check`.
