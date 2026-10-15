# 0014 — Trang giới thiệu công khai, workspace nằm sau đăng nhập

- **Ngày**: 2026-10-15
- **Trạng thái**: Accepted
- **Liên quan**: [0008](0008-identity-permissions-pilot-and-deployment.md) (session, RBAC),
  [0009](0009-deployment-topology-and-backup.md) (triển khai), [0002](0002-demo-scope-and-labels.md) (nhãn trạng thái)

## Bối cảnh

Sản phẩm được xây tiếp từ mốc demo, và cái mốc đó để lại dấu ở đúng chỗ nhìn thấy nhiều nhất: `/`
là một màn hình trong workspace, có sidebar và tự gọi mình là "bản demo tương tác". Với người
đánh giá sản phẩm để mua — người chưa có tài khoản — ấn tượng đầu tiên là một bản demo nội bộ,
không phải một sản phẩm. Đồng thời các nhãn cũ đã sai: Workflow, Tasks và Analytics bị dán `mock`
trong khi cả ba đọc/ghi dữ liệu thật.

Yêu cầu: có một trang giới thiệu công khai để bán hàng, và hệ thống chỉ hiện ra sau khi đăng nhập.

## Quyết định

1. **`/` là trang giới thiệu công khai, không mang khung ứng dụng.** Nó là một route riêng trong
   root layout (không sidebar, không topbar, không breadcrumb), nói rõ sản phẩm làm được gì, cho ai,
   và đang ở đâu. Người đã có session thấy nút "Vào workspace" thay cho "Đăng nhập".
2. **Workspace nằm trong route group `(workspace)`.** Route group không đổi URL, nên các màn hình
   vẫn là `/objects`, `/tasks`… như cũ; nhà của chúng đổi để khung ứng dụng (sidebar, topbar,
   footer) chỉ bọc đúng phần sau đăng nhập. Trang Tổng quan của workspace dời sang `/overview` vì
   `/` đã thuộc trang giới thiệu.
3. **Cổng đăng nhập là `proxy.ts`, không phải từng trang.** Next 16 gọi file này là proxy (tên cũ:
   middleware). Nó chỉ kiểm tra *sự có mặt* của cookie session — thứ duy nhất nó biết — rồi chuyển
   người chưa đăng nhập sang `/login?next=<đường dẫn họ muốn>`. Việc xác thực token vẫn ở API cho
   mọi lời gọi (ADR 0008); một cookie hết hạn vẫn vào được màn hình, và màn hình tự nói rằng nó
   không đọc được dữ liệu.
4. **Sau đăng nhập, quay lại đúng chỗ.** `?next=` chỉ nhận đường dẫn nội bộ bắt đầu bằng một dấu
   `/`; URL tuyệt đối hoặc `//host` bị bỏ qua và rơi về `/overview`, để tham số này không thể dùng
   để đẩy người dùng ra khỏi ứng dụng.
5. **Trang giới thiệu phải trung thực.** Không có khách hàng, logo, testimonial hay bảng giá được
   bịa ra; phần "Chưa có" được nêu ngay trên trang (OIDC/SSO chờ IdP, SLA thuộc V1.x, adapter hai
   chiều chưa có). Cùng chuẩn với nhãn trạng thái trong sản phẩm (ADR 0002): không trình bày thứ
   chưa có như thứ đã có.
6. **Nhãn `mock` trên màn hình lỗi bị bỏ.** Một màn hình không đọc được API thì không phải đang mô
   phỏng; nó không mang nhãn nào, và câu giải thích nằm trong thẻ lỗi.

## Hệ quả

- Đổi cấu trúc thư mục: `app/(workspace)/**` cho các màn hình sau đăng nhập, `app/page.tsx` (trang
  giới thiệu) và `app/login/` ở ngoài. Component nhập server action theo đường dẫn thật
  (`@/app/(workspace)/objects/actions`).
- Cookie session có tên trong `lib/session-cookie.ts` — module không import `next/headers` — để
  proxy (edge runtime) dùng được cùng hằng số mà không kéo API chỉ dành cho Node vào bundle.
- `buildinfo.Stage` đổi từ `demo` sang `mvp`; contract cho phép `demo | mvp | production`, nên không
  cần đổi OpenAPI. Topbar hiển thị giai đoạn đọc từ API, không hard-code.
- Smoke test kiểm tra đúng cấu trúc này: trang giới thiệu đọc được khi chưa đăng nhập, `/tasks`
  không session trả 307 kèm `next`, và các màn hình workspace được kiểm tra bằng session thật.
- Trang giới thiệu chưa có bảng giá hay luồng liên hệ: đó là quyết định bán hàng, không phải quyết
  định kỹ thuật, và không được tự bịa.
