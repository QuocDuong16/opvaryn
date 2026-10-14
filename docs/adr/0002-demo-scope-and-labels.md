# 0002 — Phạm vi demo và quy ước nhãn live/mock/concept

- **Ngày**: 2026-10-13
- **Trạng thái**: Accepted (phạm vi bản demo)
- **Liên quan**: playbook `index.html` nguyên tắc 05, `demo-mvp.html`, `roadmap.html`, decision
  log D05 và D08

## Bối cảnh

Playbook yêu cầu bản demo minh họa tầm nhìn nhưng phải phân biệt rõ giữa chạy thật, mô phỏng và
concept. Đồng thời, Process Execution Contract (lifecycle, concurrency, reject/return,
idempotency) vẫn là quyết định mở D05/D08 — viết runtime trước khi chốt sẽ khóa sớm những quyết
định chưa được review.

## Cập nhật

> Điểm 2 dưới đây ("Runtime workflow không được triển khai trong giai đoạn demo") **đã hết hiệu
> lực**: chủ dự án đã chốt D04/D05/D08 (xem [ADR 0005](0005-runtime-decisions-proposal.md)) và hợp
> đồng thực thi nằm ở [ADR 0007](0007-process-execution-contract.md). Các điểm còn lại — quy ước
> nhãn live/mock/concept, lát cắt chạy thật, và "schema đi cùng feature" — vẫn giữ nguyên.

## Quyết định

1. Mọi màn hình và khối chức năng phải khai báo trạng thái bằng `StatusBadge`:
   - `live` — chạy thật qua API Go và PostgreSQL, thao tác có hiệu lực thật.
   - `mock` — giao diện thật, dữ liệu/hành vi giả lập.
   - `concept` — minh họa tầm nhìn, chưa có hành vi, thường thuộc V2/V3.
2. Runtime workflow **không** được triển khai trong giai đoạn demo. Trang Workflows/Tasks chỉ
   minh họa trải nghiệm thiết kế và ghi rõ lý do chờ D05/D08.
3. Lát cắt chạy thật đầu tiên là Business Objects: tạo và liệt kê definition qua API, lưu trong
   PostgreSQL. Đây là nền cho Form Builder (tuần 2–3) và là mẫu để nhân rộng cho các module khác.
4. Không thêm bảng dữ liệu cho entity chưa có feature (process definition/instance, task,
   event). Schema đi cùng feature, không đi trước.

## Hệ quả

- Reviewer có thể phân biệt năng lực thật và phần trình diễn chỉ bằng nhìn nhãn, không cần hỏi.
- Khi runtime workflow bắt đầu, nó sẽ cần ADR riêng mô tả execution contract đã chốt, kèm
  migration mới — các migration đã áp dụng là bất biến.
- Bản demo không thể trả lời câu hỏi vận hành thật (SLA, concurrency, retry). Truyền thông nội
  bộ phải nói rõ giới hạn này.
