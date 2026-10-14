# OPVARYN

**BUSINESS OPERATIONS PLATFORM**

> Build how work runs.
>
> Design · Automate · Connect · Analyze

Repository này triển khai **Interactive Demo** của OPVARYN — bản trình diễn 8 tuần theo
[operations-playbook](operations-playbook/index.html). Yêu cầu, nguyên tắc và roadmap đầy đủ nằm
trong playbook; [docs/README.md](docs/README.md) giải thích quan hệ giữa playbook và code.

## Trạng thái hiện tại

Các màn hình theo kế hoạch 8 tuần của bản demo đã dựng xong và phần MVP V1 đang được triển khai
tiếp trên cùng nền đó. Mỗi màn hình gắn nhãn trạng thái:

- **Live**: Business Objects và bản ghi — khai schema, tạo định nghĩa, nhập bản ghi bằng form sinh
  từ schema; dữ liệu đi qua API Go và lưu trong PostgreSQL. **Sửa định nghĩa sẽ publish một phiên
  bản mới bất biến, và bản ghi giữ phiên bản nó được tạo ra** (MVP: "Config versioning"). Form
  Builder preview dùng đúng component nhập liệu đó. Overview đọc trạng thái API/database thật.
  Application showcase đọc danh sách và chi tiết từ bản ghi thật. Bố cục dashboard ở Analytics lưu
  thật (cookie trình duyệt).
- **Live**: Tasks — inbox đọc từ engine theo đúng role người đang đăng nhập, mở một việc để xem bản
  ghi (theo phiên bản định nghĩa của nó), event log append-only, và duyệt / trả về / từ chối qua
  đúng một transaction có compare-and-swap.
- **Live**: Workflows — danh sách định nghĩa, canvas vẽ graph của **phiên bản đã publish** (toạ độ
  tính từ graph, không lưu), xem lại phiên bản cũ, tạo định nghĩa mới và publish phiên bản tiếp theo
  bằng biểu mẫu; mọi kiểm tra graph nằm ở service Go. Trang bản ghi cũng có mục **chạy quy trình** và
  danh sách instance theo bản ghi/định nghĩa (`GET /api/v1/process-instances`).
- **Live**: Analytics — metric định nghĩa bằng field của business object (đếm / tổng / trung bình,
  lọc theo đúng ngôn ngữ điều kiện của quy trình, nhóm theo một field), chạy trên projection có kiểu
  và trả về đúng phạm vi dữ liệu người đăng nhập được đọc; dashboard sắp bố cục và lưu lại. D06 chốt
  hướng tự viết (ADR 0010). Metric vận hành quy trình (cycle time, SLA…) vẫn là `concept`.
- **Mock**: kanban và connector trong Application showcase.
- **Live (MVP)**: workflow runtime tự xây trên PostgreSQL — process definition publish theo phiên
  bản bất biến, instance gắn với phiên bản lúc start, human task duyệt theo role với
  compare-and-swap, reject terminal, return reset attempt, event log append-only (ADR 0005/0007).
  Ba quy trình pilot của D07 (`purchase_approval`, `incident_triage`, `hr_onboarding_flow`) được
  publish và seed sẵn việc đang chờ bằng `make seed-demo`.
- **Live (MVP)**: identity local — đăng nhập bằng mật khẩu argon2id, session cookie httpOnly (chỉ
  lưu hash của token), role và bộ phận trên user. **Mọi endpoint đều cần đăng nhập** (trừ health,
  meta và auth); tạo/publish định nghĩa cần `admin` hoặc `process_designer`; đọc bản ghi theo bộ
  phận mình + việc mình đang giữ; `GET /api/v1/tasks` là inbox theo người dùng. Tài khoản tạo bằng
  `make useradm` (ADR 0008).
- **Concept**: điều kiện hiển thị và calculated field của Form Builder, tab Cấu hình của Application
  Builder, SLA/escalation, template library, và nội dung Roadmap — các phần phụ thuộc quyết định
  còn mở hoặc thuộc V1.x.

Toàn bộ D04–D10 đã chốt và đang chạy trong code (ADR 0005–0010). Chi tiết phạm vi demo ở
[ADR 0002](docs/adr/0002-demo-scope-and-labels.md),
[ADR 0003](docs/adr/0003-demo-data-slice-and-mock-surfaces.md),
[ADR 0004](docs/adr/0004-dashboard-layout-storage-and-demo-flow-tests.md) và hạng mục MVP đã làm ở
[ADR 0006](docs/adr/0006-definition-versioning.md), [ADR 0007](docs/adr/0007-process-execution-contract.md),
[ADR 0008](docs/adr/0008-identity-permissions-pilot-and-deployment.md),
[ADR 0009](docs/adr/0009-deployment-topology-and-backup.md),
[ADR 0010](docs/adr/0010-analytics-query-builder.md).

## Bắt đầu nhanh

Yêu cầu: [mise](https://mise.jdx.dev) và Docker. Hướng dẫn đầy đủ (kèm walkthrough từng màn hình và
xử lý sự cố) nằm ở [docs/demo-guide.md](docs/demo-guide.md).

```bash
mise install                 # pin go 1.27.2, node 26.9.0, pnpm 12.12.0 + Go tools
pnpm install                 # cài dependency cho apps/web và packages
cp .env.example .env         # cổng 21xxx, không đụng project khác trên máy

make docker-up               # PostgreSQL 18 (localhost:21532)
cd apps/api && go run ./cmd/migrate && cd ../..

make dev                     # terminal 1: API :21501 + web :21500
```

Đợi API và web lên, rồi ở terminal 2 nạp dữ liệu mẫu (tuỳ chọn — cần API đang chạy):

```bash
make seed-demo               # 3 business object, 3 quy trình pilot + việc đang chờ, qua chính API
```

Mở http://localhost:21500 và đi theo Walkthrough ở trang Tổng quan. Trang Objects cho phép tạo
business object thật với field schema; mở một object để nhập bản ghi bằng form sinh từ schema.

## Chạy trên host nội bộ

Toàn bộ sản phẩm (migrate → API → web → job backup) chạy bằng Docker Compose trên một host, đúng
quyết định D10:

```bash
cp .env.example .env         # đổi POSTGRES_PASSWORD trước khi dùng thật
make pilot-up                # build image rồi dựng cả stack (profile `pilot`)
make pilot-logs              # theo dõi log
make backup                  # ghi một dump đã được kiểm tra đọc lại
make restore-drill           # phục hồi dump mới nhất vào DB tạm và chứng minh API chạy được trên đó
make pilot-down              # dừng stack, giữ volume và dump
```

`make docker-up` (không profile) vẫn chỉ dựng PostgreSQL cho dev local. Quy trình vận hành đầy đủ —
bí mật, cập nhật phiên bản, phục hồi khi database hỏng, xử lý sự cố — nằm ở
[docs/ops-runbook.md](docs/ops-runbook.md); lý do đằng sau topology ở
[ADR 0009](docs/adr/0009-deployment-topology-and-backup.md),
[ADR 0010](docs/adr/0010-analytics-query-builder.md).

Các target thường dùng:

| Lệnh | Việc |
| --- | --- |
| `make help` | Danh sách toàn bộ target |
| `make dev` | Chạy API và web cùng lúc |
| `make api-check` | Contract, format, lint, security, test, build cho Go |
| `make web-check` | Lint, format, typecheck, test, build cho web |
| `make quality-check` | Toàn bộ gate phía trên + kiểm tra docs |
| `make contract-generate` | Sinh types Go/TypeScript từ OpenAPI |
| `make smoke-api` | Build API, chạy thử lát cắt business object + bản ghi trên PostgreSQL thật |
| `make smoke-demo-flows` | Build cả API và web, replay form của các luồng demo và kiểm chứng kết quả |
| `make seed-demo` | Nạp business object và bản ghi mẫu qua API (idempotent) |
| `make docker-up` / `make docker-down` | Bật/tắt PostgreSQL local |
| `make actions-lint` | Lint workflow GitHub Actions bằng actionlint |

## Chất lượng và CI

- `make quality-check` là gate duy nhất: contract freshness, format, lint, quét bảo mật
  (gosec, govulncheck), test, build production, lint workflow và kiểm tra docs.
- GitHub Actions chạy đúng gate đó ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), kèm
  một job integration dùng PostgreSQL thật: apply migration, chạy `make smoke-api` rồi
  `make smoke-demo-flows` (build cả web, replay form của các luồng demo và kiểm chứng dữ liệu lưu).
- [CodeQL](.github/workflows/codeql.yml) quét Go và TypeScript trên mỗi PR, mỗi lần push lên
  `main` và hằng tuần; [dependency review](.github/workflows/dependency-review.yml) chặn
  dependency mới có lỗ hổng mức high hoặc license copyleft.
- Dependabot mở PR cập nhật theo tuần cho gomod, npm, GitHub Actions và docker-compose. Các pin
  trong `mise.toml` (go/node/pnpm, công cụ Go) và digest image được cập nhật thủ công.

## Bảo mật và giấy phép

Repo này **công khai nhưng không phải open source**: xem [LICENSE.md](LICENSE.md) — bản quyền
thuộc về tác giả, không cho phép sao chép, phát hành lại hay dùng cho mục đích thương mại. Tên
OPVARYN và các tên module được bảo lưu.

Báo lỗ hổng bảo mật qua GitHub Security Advisories (tab Security → Report a vulnerability), không
mở issue công khai — chi tiết trong [SECURITY.md](SECURITY.md). Đóng góp từ bên ngoài không được
nhận; xem [CONTRIBUTING.md](CONTRIBUTING.md) và [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Cấu trúc repository

```text
opvaryn/
├── apps/
│   ├── api/                  # Go modular monolith (httpapi → service → store)
│   │   ├── cmd/server/       # HTTP server
│   │   ├── cmd/migrate/      # migration runner
│   │   ├── internal/         # api/v1 (generated), httpapi, service, store, domain
│   │   ├── openapi/          # hợp đồng HTTP — nguồn sự thật duy nhất
│   │   └── sql/migrations/   # migration bất biến sau khi áp dụng
│   └── web/                  # Next.js App Router + Tailwind v4 + design tokens
├── packages/
│   └── contracts/            # types TypeScript sinh từ OpenAPI + typed API client
├── deployments/              # docker-compose cho hạ tầng local
├── docs/                     # ADR và tài liệu kỹ thuật
├── operations-playbook/      # sổ tay yêu cầu (nguồn yêu cầu, không phải code)
├── scripts/                  # quality gate scripts
├── AGENTS.md                 # quy ước làm việc trong repo
└── mise.toml                 # pin toolchain (có mise.lock)
```

## Tại sao là OPVARYN?

Tên được xây dựng từ **Operations + Variability**, nhấn mạnh khả năng tùy biến cách doanh nghiệp
vận hành.

- **Ngắn:** 7 ký tự, dùng được cho repository, CLI, API và thương hiệu.
- **Không bó hẹp:** Sau này phát triển Application Builder, Automation hay AI đều không cần đổi tên.
- **Có thể xây hệ sinh thái:** Các module có tên riêng nhưng vẫn thuộc một nền tảng.
- **Có tính nhận diện:** Không sử dụng các từ chung như Flow, Form, Process hay ERP làm tên chính.

## Cấu trúc thương hiệu về sau

| Tên              | Chức năng                                   |
| ---------------- | ------------------------------------------- |
| OPVARYN Core     | Nền tảng và execution engine                |
| OPVARYN Studio   | Business Object, Form & Application Builder |
| OPVARYN Flow     | Workflow Designer và Automation             |
| OPVARYN Connect  | Integration Hub                             |
| OPVARYN Insights | Analytics và Reporting                      |

## Lưu ý thương mại

Tên OPVARYN đã được rà sơ bộ trên web và chưa tìm thấy thương hiệu phần mềm nổi bật trùng chính
xác. Tuy nhiên, **chưa xác nhận được domain, GitHub organization hay khả năng đăng ký nhãn hiệu**.
Trước khi chốt tên pháp lý hoặc mua domain, cần kiểm tra chính thức các mục này. Một số tên khá
gần ý tưởng như [Orqio](https://orqio.io) và Orqanta đã có sản phẩm hoạt động.

**Đề xuất chốt:** Dùng `opvaryn` làm tên repository và tên dự án kỹ thuật ngay từ đầu; giữ trạng
thái thương hiệu thương mại là **provisional** cho đến khi hoàn tất kiểm tra nhãn hiệu.

## Tài liệu

- [operations-playbook/index.html](operations-playbook/index.html) — tầm nhìn, module, kiến trúc
  dự kiến, roadmap, decision log D01–D10.
- [docs/demo-guide.md](docs/demo-guide.md) — runbook chạy demo: setup, walkthrough 9 màn hình, sự cố.
- [docs/README.md](docs/README.md) — quan hệ giữa playbook và repo, danh sách ADR.
- [AGENTS.md](AGENTS.md) — quy ước làm việc, biên giới kiến trúc, quy tắc an toàn dữ liệu.
- [LICENSE.md](LICENSE.md) · [SECURITY.md](SECURITY.md) · [CONTRIBUTING.md](CONTRIBUTING.md) ·
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — giấy phép, chính sách bảo mật và quy ước đóng góp.
