# Documentation index

| Tài liệu | Nội dung |
| --- | --- |
| [`../README.md`](../README.md) | Điểm vào dự án: trạng thái, bắt đầu nhanh, cấu trúc repository |
| [`demo-guide.md`](demo-guide.md) | Runbook chạy và trình bày demo: setup, walkthrough từng màn hình, sự cố thường gặp |
| [`ops-runbook.md`](ops-runbook.md) | Runbook vận hành trên host nội bộ: deploy, cấu hình, backup, diễn tập phục hồi, sự cố |
| [`../AGENTS.md`](../AGENTS.md) | Quy ước làm việc cho agent và contributor |
| [`../operations-playbook/index.html`](../operations-playbook/index.html) | Nguồn yêu cầu: tầm nhìn, module, kiến trúc dự kiến, roadmap, decision log |
| [`../LICENSE.md`](../LICENSE.md) | Giấy phép proprietary: không sao chép, không thương mại |
| [`../SECURITY.md`](../SECURITY.md) | Chính sách báo lỗ hổng và phạm vi bảo mật |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Ai được commit, quy tắc PR, ràng buộc license của dependency |
| [`../CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | Quy ước ứng xử (Contributor Covenant 2.1) |
| [`../.github/`](../.github/) | CI (quality gate + integration), CodeQL, dependency review, Dependabot, template issue/PR |
| [`adr/`](adr/) | Architecture Decision Records của repo này |

## Quan hệ giữa playbook và repo

- **Playbook** (`operations-playbook/`) là sổ tay chiến lược sản phẩm: tầm nhìn, nguyên tắc,
  domain model dự kiến, ước lượng và các quyết định còn mở (D01–D10). Nó mô tả cả sản phẩm
  lẫn MVP, không chỉ bản demo.
- **Repo** này triển khai **Interactive Demo** (mục 04 trong playbook). Các quyết định kỹ thuật
  đã chốt riêng cho repo được ghi thành ADR; khi ADR và playbook khác nhau, ADR thắng cho phạm
  vi repo, còn playbook vẫn là nguồn yêu cầu sản phẩm.
- Nội dung gốc trong playbook không sửa theo code. Khi phát hiện playbook đã cũ (ví dụ tên dự
  án, hoặc ghi chú trạng thái), cập nhật playbook như một thay đổi tài liệu riêng.

## ADR hiện có

- [0001 — Modular monolith với Go, Next.js và PostgreSQL](adr/0001-modular-monolith-stack.md)
- [0002 — Phạm vi demo và quy ước nhãn live/mock/concept](adr/0002-demo-scope-and-labels.md)
- [0003 — Lát cắt dữ liệu của demo: bản ghi business object và phân chia live/mock](adr/0003-demo-data-slice-and-mock-surfaces.md)
- [0004 — Bố cục dashboard lưu bằng cookie, và cách kiểm thử luồng demo](adr/0004-dashboard-layout-storage-and-demo-flow-tests.md)
- [0005 — Quyết định cho execution contract (D04, D05, D08) — Accepted](adr/0005-runtime-decisions-proposal.md)
- [0006 — Versioning cho definition: publish là bất biến, bản ghi gắn với phiên bản](adr/0006-definition-versioning.md)
- [0007 — Process Execution Contract (node, transition, audit)](adr/0007-process-execution-contract.md)
- [0008 — Identity, phân quyền, quy trình pilot và môi trường chạy](adr/0008-identity-permissions-pilot-and-deployment.md)
- [0009 — Kiến trúc triển khai trên một host nội bộ, và backup có diễn tập phục hồi](adr/0009-deployment-topology-and-backup.md)
- [0010 — Analytics: query builder giới hạn tự viết trên projection có kiểu (D06)](adr/0010-analytics-query-builder.md)
- [0011 — Metric vận hành quy trình: read model cố định trên cột có kiểu](adr/0011-process-operational-metrics.md)
- [0012 — Tích hợp ra ngoài: webhook có hàng đợi, retry và nhật ký giao](adr/0012-outbound-webhook-integration.md)
