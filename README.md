# OPVARYN

**BUSINESS OPERATIONS PLATFORM**

> Build how work runs.
>
> Design · Automate · Connect · Analyze

Repository này triển khai **Interactive Demo** của OPVARYN — bản trình diễn 8 tuần theo
[operations-playbook](operations-playbook/index.html). Yêu cầu, nguyên tắc và roadmap đầy đủ nằm
trong playbook; [docs/README.md](docs/README.md) giải thích quan hệ giữa playbook và code.

## Trạng thái hiện tại

Các màn hình theo kế hoạch 8 tuần của bản demo đã dựng xong, mỗi màn hình gắn nhãn trạng thái:

- **Live**: Business Objects và bản ghi — khai schema, tạo định nghĩa, nhập bản ghi bằng form sinh
  từ schema; dữ liệu đi qua API Go và lưu trong PostgreSQL. Form Builder preview dùng đúng
  component nhập liệu đó. Overview đọc trạng thái API/database thật. Application showcase đọc
  danh sách và chi tiết từ bản ghi thật.
- **Mock**: Workflows (sơ đồ quy trình đọc từ fixture), Tasks (inbox duyệt/trả về/từ chối đổi state
  trong trình duyệt), Analytics (metric catalog trên số liệu fixture), kanban và connector trong
  Application showcase.
- **Concept**: điều kiện hiển thị và calculated field của Form Builder, escalation, template
  library — các phần phụ thuộc quyết định còn mở.

Workflow runtime chưa được viết vì Process Execution Contract (D05/D08 trong playbook) chưa chốt;
chi tiết phạm vi nằm ở [ADR 0002](docs/adr/0002-demo-scope-and-labels.md) và
[ADR 0003](docs/adr/0003-demo-data-slice-and-mock-surfaces.md).

## Bắt đầu nhanh

Yêu cầu: [mise](https://mise.jdx.dev) và Docker.

```bash
mise install                 # pin go 1.27.2, node 26.9.0, pnpm 12.12.0 + Go tools
pnpm install                 # cài dependency cho apps/web và packages
cp .env.example .env         # cổng 21xxx, không đụng project khác trên máy

make docker-up               # PostgreSQL 18 (localhost:21532)
cd apps/api && go run ./cmd/migrate && cd ../..

make seed-demo              # tuỳ chọn: nạp 2 business object mẫu + bản ghi demo qua API
make dev                     # API :21501 + web :21500
```

Mở http://localhost:21500 và đi theo Walkthrough ở trang Tổng quan. Trang Objects cho phép tạo
business object thật với field schema; mở một object để nhập bản ghi bằng form sinh từ schema.

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
| `make seed-demo` | Nạp business object và bản ghi mẫu qua API (idempotent) |
| `make docker-up` / `make docker-down` | Bật/tắt PostgreSQL local |
| `make actions-lint` | Lint workflow GitHub Actions bằng actionlint |

## Chất lượng và CI

- `make quality-check` là gate duy nhất: contract freshness, format, lint, quét bảo mật
  (gosec, govulncheck), test, build production, lint workflow và kiểm tra docs.
- GitHub Actions chạy đúng gate đó ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), kèm
  một job integration dùng PostgreSQL thật để apply migration và chạy `make smoke-api`.
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
- [docs/README.md](docs/README.md) — quan hệ giữa playbook và repo, danh sách ADR.
- [AGENTS.md](AGENTS.md) — quy ước làm việc, biên giới kiến trúc, quy tắc an toàn dữ liệu.
- [LICENSE.md](LICENSE.md) · [SECURITY.md](SECURITY.md) · [CONTRIBUTING.md](CONTRIBUTING.md) ·
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — giấy phép, chính sách bảo mật và quy ước đóng góp.
