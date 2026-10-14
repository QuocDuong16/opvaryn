# 0009 — Kiến trúc triển khai trên một host nội bộ, và backup có diễn tập phục hồi

- **Ngày**: 2026-10-14
- **Trạng thái**: Accepted
- **Liên quan**: [0008](0008-identity-permissions-pilot-and-deployment.md) (D10),
  playbook `decisions.html`, `architecture.html`, [ops-runbook](../ops-runbook.md)

## Bối cảnh

D10 đã chốt hướng: **một máy chủ nội bộ + Docker Compose**, backup `pg_dump` định kỳ, log ra file,
healthcheck như hiện có; và "restore được diễn tập ít nhất một lần trước khi pilot thật chạy — backup
chưa thử restore không được coi là backup". Cho tới bước này repo mới có `deployments/docker-compose.yml`
chạy **Postgres local**; API và web chạy trên host bằng `make dev`, không có image, không có job
backup, không có đường triển khai nào.

Câu hỏi cần chốt: đóng gói ra sao, thứ tự khởi động, backup ghi ở đâu, và cái gì chứng minh backup
dùng được.

## Quyết định

1. **Một compose file, hai chế độ.** `deployments/docker-compose.yml` giữ nguyên hành vi cũ khi chạy
   không profile (`postgres` cho dev local) và thêm **profile `pilot`** với `migrate`, `api`, `web`,
   `backup`. Một file nghĩa là topology dev và topology chạy thật không thể lệch nhau; profile nghĩa
   là `make docker-up` + `make dev` không đổi.
2. **Hai image, base pin theo digest.** `apps/api/Dockerfile` (Go build tĩnh `CGO_ENABLED=0`,
   runtime Alpine tối giản, user không phải root, kèm `sql/` để migration chạy được) và
   `apps/web/Dockerfile` (Next.js **standalone**, context là repo root vì app dùng workspace package
   `@opvaryn/contracts`). Image của chính sản phẩm được build tại chỗ với tag `${OPVARYN_*_IMAGE}`
   (mặc định `:local`) — chưa có registry, và chưa cần: pilot chạy trên một host.
3. **Migration là service một lần, `api` phụ thuộc vào nó.** `migrate` chạy `/app/migrate` rồi thoát;
   `api` có `depends_on: migrate: service_completed_successfully`. Hệ quả: deploy không bao giờ phục
   vụ database chưa migrate, và migration lỗi thì rollout dừng thay vì chạy nửa vời. Vì image có
   entrypoint là server, service này **thay entrypoint** (không thêm `command`) — bài học từ lần chạy
   đầu tiên, khi `command` bị nối vào entrypoint và sinh ra một API server thứ hai.
4. **Backup là một job trong cùng compose, dùng lại chính image PostgreSQL** (`pg_dump` luôn khớp
   phiên bản server). Script `scripts/backup-db.sh` (POSIX sh) ghi dump `-Fc`, **đọc lại bằng
   `pg_restore --list`** trước khi báo thành công, rồi giữ `BACKUP_KEEP` bản mới nhất. Dump ghi ra
   `${BACKUP_DIR}` (bind mount) — runbook nói rõ phải trỏ ra ổ đĩa thứ hai hoặc thư mục được đồng bộ:
   bản sao nằm cùng máy với database không phải backup.
5. **Diễn tập phục hồi là một lệnh, và là một phần của định nghĩa "đã backup".**
   `scripts/restore-drill.sh` (`make restore-drill`) phục hồi dump mới nhất vào database tạm, so
   `schema_migrations` và số dòng các bảng chính với nguồn, kiểm tra mọi instance còn trỏ đúng bản ghi
   và phiên bản định nghĩa, rồi **start API trỏ vào bản phục hồi** để chứng minh đăng nhập và đọc
   inbox chạy được. Database nguồn không bị ghi; database tạm bị xoá kể cả khi drill fail.
6. **CI build image, không push.** Job integration có thêm bước `make images-build`, để Dockerfile
   hỏng hoặc base image ngừng resolve làm fail gate thay vì làm hỏng lần deploy sau. Workflow vẫn gọi
   target Makefile, tên job không đổi (branch ruleset).
7. **Không có staging** ở giai đoạn này (đúng ADR 0008): pilot chạy một môi trường, mọi thay đổi đi
   qua `main` + CI. Khi cần staging, đó là ADR mới.

## Hệ quả

- Một lệnh để dựng sản phẩm trên host (`make pilot-up`), một lệnh để sao lưu (`make backup`), một
  lệnh để chứng minh sao lưu dùng được (`make restore-drill`).
- Web container **không** nói chuyện trực tiếp với browser về API: `API_BASE_URL=http://api:21501`
  chỉ tồn tại phía server, đúng mô hình BFF của ADR 0008. Vì vậy cùng một image chạy được với bất kỳ
  host API nào, không cần build lại.
- Cookie session chỉ được đặt `Secure` khi `API_ENV != development`; runbook ghi rõ thứ tự: dựng
  HTTPS trước, rồi mới đặt `production`, nếu không trình duyệt sẽ không gửi cookie.
- Backup job chạy bằng root **trong container của nó** vì dump dir là bind mount thuộc user host;
  đánh đổi này được ghi trong compose và runbook thay vì để mỗi lần backup fail vì uid.
- Chưa có: registry/push image, monitoring ngoài healthcheck, cảnh báo khi backup fail (log là kênh
  duy nhất), xoay log ở tầng host, và restore tự động. Những thứ đó thuộc V1.x hoặc ADR sau.
