# 0006 — Versioning cho definition: publish là bất biến, bản ghi gắn với phiên bản

- **Ngày**: 2026-10-13
- **Trạng thái**: Accepted (mốc MVP V1, mục "Config versioning")
- **Liên quan**: playbook `architecture.html` mục 05 (bất biến 1), `demo-mvp.html` (điều kiện nghiệm
  thu MVP #1), [0002](0002-demo-scope-and-labels.md), [0003](0003-demo-data-slice-and-mock-surfaces.md),
  [0005](0005-runtime-decisions-proposal.md)

## Bối cảnh

Demo đã chạy thật phần định nghĩa và bản ghi, nhưng định nghĩa nằm trong một dòng duy nhất
(`business_objects.fields`) và bản ghi chỉ tham chiếu `object_id`. Hai việc không thể làm được với
hình dạng đó:

- **MVP yêu cầu admin sửa định nghĩa mà không sửa code** (điều kiện nghiệm thu #1), tức phải có
  đường chỉnh schema sau khi đã tạo.
- **Playbook bất biến 1: version đã publish là bất biến.** Nếu sửa dòng định nghĩa tại chỗ thì bản
  ghi cũ bị đọc bằng schema mới — dữ liệu đã ghi bị diễn giải lại, đúng thứ bất biến này cấm.

## Quyết định

1. Bảng `business_object_versions` lưu **mọi snapshot đã publish** (`id, object_id, version, name,
   description, fields, published_at, published_by`) và là **nguồn sự thật duy nhất của schema**;
   cột `business_objects.fields` bị bỏ để không tồn tại hai bản sao.
2. **Publish ngay khi tạo**: `POST /business-objects` tạo định nghĩa và publish v1 trong cùng một
   transaction (giữ nguyên hành vi demo: object dùng được ngay).
3. **Sửa = publish phiên bản kế tiếp**: `PUT /business-objects/{key}` validate y như tạo, rồi trong
   một transaction khoá dòng object (`FOR UPDATE`), tính `MAX(version) + 1`, ghi snapshot mới và cập
   nhật dòng object. Hai lần publish đồng thời không thể chọn trùng số phiên bản.
4. **Bản ghi gắn với phiên bản**: `business_object_records.object_version_id` (NOT NULL, FK) được ghi
   lúc tạo, và khi đọc, store join sang `business_object_versions` để trả về số phiên bản. API trả
   `objectVersion` trên mỗi bản ghi.
5. **UI đọc bản ghi theo phiên bản của chính nó**: trang object gom bản ghi thành từng nhóm theo
   phiên bản, mỗi nhóm render cột từ schema của phiên bản đó; nhóm cũ được gắn nhãn "phiên bản cũ —
   bản ghi giữ nguyên schema". Không có chuyện bảng mới áp lên dữ liệu cũ.
6. **Chưa có trạng thái nháp**: sửa là publish ngay. Tách nháp/publish có ý nghĩa nhất với definition
   của quy trình, và sẽ được quyết cùng mô hình publish của workflow sau khi chốt D05/D08
   ([ADR 0005](0005-runtime-decisions-proposal.md)).
7. **Actor của lần publish** được lưu ở `published_by`; hiện luôn là `system`. Identity đã có
   (ADR 0008), nhưng service chưa ghi người phát hành vào cột này — khi làm, giá trị sẽ là user thật
   và không cần đổi schema.
8. **Cho phép thêm, đổi nhãn và bỏ field**: bản ghi cũ giữ phiên bản của nó, nên lịch sử không bị
   viết lại. Đây chính là điểm khác biệt so với sửa tại chỗ.

## Hệ quả

- Migration `0003_definition_versions.sql` đã áp dụng: tạo bảng phiên bản, đưa mọi định nghĩa hiện
  có thành v1 (giữ `created_at` làm thời điểm publish), gắn bản ghi cũ vào v1, rồi bỏ cột `fields`.
- Bỏ một cột là thay đổi phá vỡ tương thích ở tầng dữ liệu; chỉ store và API của repo này đọc nó, và
  cả hai đã chuyển sang đọc phiên bản mới nhất qua `LATERAL JOIN`.
- Xoá định nghĩa cascade sang phiên bản và bản ghi. API chưa có endpoint xoá; khi thêm, phải chọn
  giữa archive và cascade thay vì để cascade là mặc định vô tình.
- Read model cho analytics (bất biến 5, quyết định D06) sẽ phải chiếu theo từng phiên bản — một field
  đổi kiểu giữa các phiên bản là chuyện bình thường, nên metric phải khai báo nó đo phiên bản nào.
- Kiểm thử: `make smoke-api` khẳng định lịch sử phiên bản và việc bản ghi cũ giữ schema cũ;
  `make smoke-demo-flows` publish một phiên bản qua chính form web rồi kiểm chứng cả API lẫn trang.
