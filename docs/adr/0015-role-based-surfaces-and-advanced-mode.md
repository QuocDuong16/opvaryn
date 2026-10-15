# 0015 — Màn hình cho người dùng, thông tin kỹ thuật cho quản trị viên ở chế độ nâng cao

- **Ngày**: 2026-10-15
- **Trạng thái**: Accepted
- **Liên quan**: [0002](0002-demo-scope-and-labels.md) (nhãn trạng thái),
  [0004](0004-dashboard-layout-storage-and-demo-flow-tests.md) (cấu hình người dùng lưu bằng cookie),
  [0008](0008-identity-permissions-pilot-and-deployment.md) (role, phân quyền),
  [0014](0014-public-landing-and-workspace.md) (trang công khai và workspace)

## Bối cảnh

Sau khi bỏ văn phong tài liệu khỏi các màn hình, vấn đề còn lại nằm ở chỗ khác: **ai đọc cái gì**.
Trang Tổng quan vẫn là bảng trạng thái của bản build (trạng thái API/database, phiên bản, giai đoạn,
danh sách màn hình kèm nhãn live/mock/concept, danh sách "chưa có trong V1", quy ước nhãn). Với
trưởng bộ phận — người chỉ cần biết hôm nay có việc gì — đó là thông tin vô nghĩa; và vì nó nằm
ngay màn hình đầu, cả sản phẩm đọc ra như một bản demo đang dở.

Yêu cầu: người dùng thường phải thấy một sản phẩm dùng được ngay; thông tin kỹ thuật chỉ dành cho
quản trị viên, và ngay cả quản trị viên cũng chỉ thấy khi chủ động bật.

## Quyết định

1. **Trang Tổng quan là bảng điều khiển cho người làm việc.** Ai đăng nhập cũng thấy: lời chào kèm
   bộ phận và role, **việc đang chờ bạn** (đọc từ inbox, tối đa 5 việc kèm liên kết), ba lối vào
   công việc thường ngày (nhập dữ liệu, xử lý việc, xem báo cáo) và **lần chạy gần đây** trong phạm
   vi người đó đọc được. Không trạng thái build, không phiên bản, không danh sách tính năng.
2. **Thông tin kỹ thuật nằm trong một khối riêng, chỉ hiện khi bật chế độ nâng cao.** Khối đó gồm
   trạng thái nền tảng (phiên bản, giai đoạn, API, cơ sở dữ liệu), danh sách màn hình kèm nhãn
   trạng thái, "chưa có trong V1" và quy ước nhãn. Nó ở *dưới* phần công việc, sau một đường phân
   cách, để không ai phải đọc nó.
3. **Hai màn hình chỉ dành cho quản trị viên, và chỉ ở chế độ nâng cao**: `Vận hành` (`/settings` —
   endpoint, cổng, lệnh seed/smoke, nhật ký tích hợp) và `Lộ trình` (`/roadmap` — kế hoạch các mốc).
   Người khác nhận **404**, cùng câu trả lời như mọi địa chỉ họ không có việc ở đó — không phải
   "403" (điều đó xác nhận màn hình tồn tại).
4. **Chế độ nâng cao là một công tắc của trình duyệt, chỉ quản trị viên thấy.** Lưu bằng cookie
   httpOnly (`opvaryn.advanced`) sau một server action, đúng cách theme và bố cục dashboard đã làm
   (ADR 0004). Giá trị của cookie **không cấp quyền gì**: nó chỉ đổi thứ được hiển thị, còn quyền
   vẫn do API quyết định ở mọi lời gọi (ADR 0008). Mặc định là tắt.
5. **Bỏ nhãn `Live` khỏi mọi màn hình.** Nhãn chỉ còn xuất hiện ở phần thật sự mô phỏng hoặc còn là
   ý tưởng — đúng nghĩa của quy ước nhãn (ADR 0002): một màn hình chạy thật không cần được trang trí
   bằng chữ "Live". Nhãn `mock`/`concept` vẫn giữ ở đúng chỗ, kèm câu giải thích bằng lời.
6. **Tên màn hình nói tiếng Việt**: Dữ liệu, Nhập liệu, Quy trình, Việc của tôi, Báo cáo, Ứng dụng,
   Vận hành, Lộ trình. Người dùng không phải dịch "Business Objects" hay "Workflows" trong đầu.

## Hệ quả

- `lib/access.ts` (`isAdmin`) và `lib/advanced.ts` (`parseAdvanced`, `toggleAdvanced`,
  `advancedVisible`) là module thuần, có test; cookie đọc ở `lib/advanced-server.ts` và ghi qua
  `app/actions/advanced.ts`. Điều hướng lọc bằng `navItemsFor(showAdvanced)` trong `app/nav.ts`;
  mỗi mục nav có trường `audience`.
- Khung workspace đọc role của người đang đăng nhập để dựng điều hướng; API hỏng thì mặc định là
  bản rút gọn (không hiện màn hình quản trị) — an toàn theo hướng không tiết lộ.
- `/settings` và `/roadmap` gọi `notFound()` khi không đủ điều kiện; smoke test chứng minh cả hai
  chiều: trưởng bộ phận nhận 404, quản trị viên bật công tắc thật rồi mới thấy.
- Công tắc là một form thật (nút có `name`), nên smoke replay được đúng đường người dùng đi, không
  phải gieo cookie bằng tay.
- Màn hình mới thêm sau này phải chọn `audience`: mặc định là `everyone`, và chỉ những màn hình mô
  tả cách hệ thống được dựng/vận hành mới là `admin`.
