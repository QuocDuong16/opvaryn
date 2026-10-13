# 0001 — Modular monolith với Go, Next.js và PostgreSQL

- **Ngày**: 2026-10-13
- **Trạng thái**: Accepted (phạm vi bản demo)
- **Liên quan**: playbook `architecture.html` mục 02 và 03, decision log D01–D03, D06

## Bối cảnh

Playbook đề xuất (chưa chốt) backend Go modular monolith, frontend React + TypeScript,
PostgreSQL với JSONB, và analytics dựa trên read model. Các lựa chọn còn mở gồm rule DSL,
workflow runtime, analytics build-vs-embed. Bản demo cần một khung chạy được ngay, không chờ
các quyết định đó, nhưng cũng không được chọn hướng đi ngược lại chúng.

## Quyết định

1. `apps/api` là **một** dịch vụ Go duy nhất, biên giới nội bộ rõ ràng theo tầng
   `httpapi` (giải mã HTTP) → `service` (luật nghiệp vụ) → `store` (PostgreSQL). Không tách
   microservice ở giai đoạn demo.
2. `apps/web` là Next.js App Router (React + TypeScript). Server Components đọc API trực tiếp;
   mutation đi qua Server Action, nhờ đó browser không cần gọi API cross-origin.
3. Hợp đồng HTTP do `apps/api/openapi/openapi.yaml` sở hữu. Types Go
   (`internal/api/v1/types.gen.go`) và TypeScript (`packages/contracts`) đều sinh từ đó bằng
   `make contract-generate`; types sinh ra được commit và không sửa tay.
4. PostgreSQL là nơi lưu trữ duy nhất; payload động dùng JSONB, nhưng field cần filter/join/đo
   lường sẽ có projection hoặc read model riêng khi feature tương ứng xuất hiện.
5. Toolchain pin bằng mise (`mise.toml` + `mise.lock`) theo convention chung của các project
   trong workspace.

## Hệ quả

- Mọi thay đổi hành vi đều phải đi kèm cập nhật OpenAPI; `make contract-check` chặn types sinh
  ra bị lệch.
- Chưa có Docker image cho API/web, chưa có CI: đều thuộc quyết định D10 (deployment) và sẽ
  được thêm khi deployment được chốt.
- Khi một module thực sự cần tách dịch vụ (ví dụ engine chạy dài), việc tách cần một ADR mới.
