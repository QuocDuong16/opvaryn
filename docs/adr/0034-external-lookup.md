# 0034 — Tra cứu lựa chọn từ hệ thống khác

- **Ngày**: 2026-10-20
- **Trạng thái**: Accepted
- **Liên quan**: [0012](0012-outbound-webhook-integration.md) (tích hợp ra ngoài),
  [0022](0022-administration-api-and-screens.md) (quyền quản trị),
  [0032](0032-computed-fields-and-smart-forms.md) (các loại trường)

## Bối cảnh

Một trường lựa chọn chỉ chứa được những mục đã khai trong định nghĩa. Nhưng nhiều danh sách thuộc
về hệ thống khác: danh mục nhà cung cấp trong hệ thống mua hàng, danh sách nhân viên trong hệ
thống nhân sự, mã kho trong hệ thống kho. Người dùng phải nhớ và gõ tay, hoặc quản trị phải
cập nhật danh sách trong OPVARYN mỗi lần đổi — và danh sách cũ nhanh lập tức sai.

Cơ chế gửi sự kiện ra ngoài (ADR 0012) không giúp: nó đẩy dữ liệu của OPVARYN ra, còn đây là
kéo dữ liệu của hệ thống khác vào.

## Quyết định

1. **Một trường lựa chọn có thể lấy lựa chọn từ một nguồn ngoài.** Nguồn là một địa chỉ
   HTTP, cấu hình theo từng trường và lưu ở `lookup_sources`.
2. **Nguồn trả về một tài liệu JSON nhỏ**:
   `{"options": [{"value": "sup-01", "label": "Công ty Một"}]}`. Hình dạng đơn giản là cố ý: tổ chức
   dùng một lớp trung gian (proxy) để đổi hệ thống cũ của họ sang hình dạng này.
3. **Máy chủ gọi nguồn, không phải trình duyệt** — nếu không, bí mật của hệ thống ngoài sẽ phải
   đưa vào trình duyệt, và sẽ không đoạt được trong nhật ký.
4. **Mỗi lần gọi có giới hạn**: 5 giây, tối đa 1 MB, tối đa 200 lựa chọn, và chỉ `http`/`https`.
   Nguồn không trả lời thì trường đó **nói rõ là không lấy được lựa chọn**, chứ không giả vờ là
   không có lựa chọn nào.
5. **Đọc thì mở cho mọi người đã đăng nhập**; **gắn nguồn thì là việc quản trị**, ở khu vực
   Quản trị (tab **Tra cứu ngoài**).
6. **Giá trị lưu là mã của nguồn**, không phải nhãn: nhãn là thứ người đọc, mã là thứ hệ thống
   so khớp.
7. **Nguồn là cấu hình, không phải dữ liệu**: nó không có phiên bản, và đổi nó không viết lại
   bản ghi nào.

## Hệ quả

- Danh sách thuộc hệ thống khác không phải sao chép vào OPVARYN nữa.
- **Tra cứu là một lời gọi ra ngoài trong đường đọc trang.** Vì vậy nó có giới hạn thời gian và
  kích thước, và một nguồn chậm làm chậm trang đó — nhưng không làm hỏng nó: trường báo lỗi và
  người dùng vẫn nhập được bằng tay.
- Hình dạng JSON là hợp đồng: đổi nó là đổi hợp đồng, nên nó được ghi ở đây và trong
  `docs/ops-runbook.md`.
- Chiều ghi của tra cứu — ghi ngược lại hệ thống ngoài — được chốt ở
  [0037](0037-two-way-lookup-write-back.md): bất đồng bộ, có hàng đợi và thử lại, và bản sửa của
  hệ thống ngoài chỉ được áp dụng khi bản ghi chưa ai sửa trong lúc chờ.
