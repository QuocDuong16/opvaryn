# Ops runbook — một host nội bộ

Hướng dẫn vận hành OPVARYN trên host nội bộ theo quyết định **D10** (ADR 0008) và kiến trúc
triển khai ở [ADR 0009](adr/0009-deployment-topology-and-backup.md). Mục tiêu: một người vận hành
đọc hết trang này là chạy được, sao lưu được và **đã thử phục hồi**.

Local development (`make docker-up` + `make dev`) không dùng trang này — xem
[demo-guide.md](demo-guide.md).

## 1. Thành phần chạy trên host

`docker compose --profile pilot` (target `make pilot-up`) chạy 5 service:

| Service | Vai trò | Ghi chú |
| --- | --- | --- |
| `postgres` | Database | Volume `postgres_data`; healthcheck `pg_isready` |
| `migrate` | Chạy migration rồi thoát | `api` chỉ start khi service này kết thúc **thành công** — deploy không bao giờ phục vụ DB chưa migrate |
| `api` | Go service | Healthcheck `/readyz`; cổng `${API_PORT}` (mặc định 21501) |
| `web` | Next.js standalone | Healthcheck `/`; cổng `${WEB_PORT}` (mặc định 21500); gọi API qua mạng nội bộ `http://api:21501` |
| `backup` | Job `pg_dump` định kỳ | Vòng lặp `scripts/backup-db.sh`; dump ghi ra `${BACKUP_DIR}` |

`postgres` **không** thuộc profile `pilot`, nên `make docker-up` vẫn chỉ dựng Postgres cho dev.

## 2. Chuẩn bị host (một lần)

```bash
git clone <repo> /opt/opvaryn && cd /opt/opvaryn
cp .env.example .env          # rồi sửa, xem mục 3
mkdir -p /srv/opvaryn-backups # nơi chứa dump, xem mục 5
make images-build             # build image API + web
make pilot-up                 # migrate → api → web → backup
```

Kiểm tra:

```bash
docker compose -f deployments/docker-compose.yml --profile pilot ps   # tất cả healthy, migrate exited(0)
curl -s localhost:21501/readyz                                       # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' localhost:21500/            # 200
```

Tạo tài khoản đầu tiên (bài toán con gà–quả trứng, ADR 0008) — chạy trong container API:

```bash
docker compose -f deployments/docker-compose.yml --profile pilot exec api /app/useradm -list
# tạo bộ phận/tài khoản: cần binary useradm; image API có sẵn /app/useradm
docker compose -f deployments/docker-compose.yml --profile pilot exec api \
  /app/useradm -create -email admin@congty.local -name 'Quản trị' -password '<mật khẩu mạnh>' \
  -department ban_giam_doc -roles admin
```

> `useradm` cần bộ phận tồn tại trước: `-create-department -key ban_giam_doc -department-name 'Ban giám đốc'`.

## 3. Bí mật và cấu hình

- Mọi cấu hình nằm trong `.env` trên host (đã bị `.gitignore`). **Không** commit `.env`, không đặt
  bí mật vào `NEXT_PUBLIC_*`.
- Bắt buộc đổi trước khi chạy thật: `POSTGRES_PASSWORD` (mật khẩu DB) và mật khẩu các tài khoản tạo
  bằng `useradm`. Mật khẩu demo trong repo chỉ dành cho máy local.
- `API_ENV=production` khi chạy thật: session cookie chỉ được đặt `Secure` khi API không ở
  development (ADR 0008) — đặt `production` **sau khi** host đã có HTTPS trước mặt (reverse proxy),
  nếu không trình duyệt sẽ không gửi cookie.
- `CORS_ALLOWED_ORIGINS` phải là origin thật của web (ví dụ `https://opvaryn.congty.local`).

## 4. Cập nhật phiên bản

```bash
git pull
make images-build
make pilot-up     # migrate chạy trước api; nếu migrate fail, api không được thay
```

- Migration là bất biến và chạy tự động; migration mới là file mới trong `apps/api/sql/migrations/`.
- Rollback: `git checkout <tag cũ>` rồi `make pilot-up` lại. **Migration đã áp dụng không tự lùi** —
  nếu bản mới có migration không tương thích ngược, phục hồi từ dump (mục 5) thay vì sửa DB tay.
- Log: `make pilot-logs` (theo từng service) hoặc `docker compose ... logs api`. Log xoay vòng theo
  cấu hình `logging` trong compose (10 MB × 3 file mỗi service).

## 5. Sao lưu và phục hồi

**Sao lưu** do service `backup` chạy định kỳ (`BACKUP_INTERVAL_SECONDS`, mặc định 1 ngày) và có thể
chạy tay:

```bash
make backup     # một lần chạy riêng, dùng đúng script và thư mục của job
ls -l deployments/backups/    # hoặc $BACKUP_DIR
```

Mỗi dump được `pg_restore --list` đọc lại ngay sau khi ghi: file hỏng/thiếu không được coi là dump
thành công. Giữ `BACKUP_KEEP` bản mới nhất (mặc định 14), bản cũ bị xoá **sau** khi lần ghi mới
thành công.

> Dump nằm trong `BACKUP_DIR`. Hãy trỏ nó ra **ổ đĩa thứ hai** hoặc thư mục được đồng bộ ra ngoài
> host: bản sao nằm cùng máy với database không phải là backup.

**Diễn tập phục hồi** — chạy sau mỗi thay đổi schema/backup và trước khi pilot bắt đầu:

```bash
make restore-drill
```

Script `scripts/restore-drill.sh` lấy dump mới nhất, tạo database tạm `opvaryn_restore_drill`, phục
hồi vào đó, rồi **so sánh với database nguồn**: `schema_migrations` và số dòng của các bảng chính
phải khớp, mọi instance phải còn trỏ đúng bản ghi và phiên bản định nghĩa. Sau đó nó tạo một tài
khoản tạm trong bản phục hồi, **start API trỏ vào bản phục hồi** và đăng nhập + đọc inbox — một bản
phục hồi không phục vụ được đăng nhập thì chưa dùng được. Cuối cùng database tạm bị xoá; database
nguồn không bị ghi vào.

Phục hồi thật (khi database hỏng):

```bash
make pilot-down
# đổi POSTGRES_DB sang tên mới trong .env nếu muốn giữ bản cũ để đối chiếu
docker compose -f deployments/docker-compose.yml up -d postgres
docker compose -f deployments/docker-compose.yml exec -T postgres \
  pg_restore --no-owner --no-privileges --exit-on-error -U opvaryn -d opvaryn \
  < deployments/backups/opvaryn-<stamp>.dump
make pilot-up
curl -s localhost:21501/readyz
```

Sau khi phục hồi: chạy lại `make restore-drill` để chắc chắn bản vừa dùng cũng qua được kiểm tra,
và ghi lại thời điểm phục hồi vào nhật ký vận hành.

## 6. Bảo trì định kỳ

```bash
# Dọn session hết hạn (API không có scheduler; chạy tay hoặc bằng cron trên host)
docker compose -f deployments/docker-compose.yml --profile pilot exec api /app/useradm -prune-sessions

# Xem tài khoản và role đang có
docker compose -f deployments/docker-compose.yml --profile pilot exec api /app/useradm -list
```

Session hết hạn vốn đã không dùng được (truy vấn lọc theo `expires_at`), nên đây thuần là dọn dẹp —
nhưng không dọn thì bảng chỉ lớn thêm. Một dòng cron mỗi ngày là đủ.

## 7. Checklist trước khi cho người thật dùng

- [ ] `.env` trên host: `POSTGRES_PASSWORD` đã đổi, `API_ENV=production`, `CORS_ALLOWED_ORIGINS` là
      origin thật.
- [ ] HTTPS đã dựng trước mặt host (nếu chưa, xem ghi chú ở mục 3 — cookie `Secure` sẽ không được gửi).
- [ ] Mỗi người dùng thật có tài khoản riêng qua `useradm` (không dùng chung, không dùng tài khoản
      `seed_*`), và role của họ khớp với role mà quy trình giao việc — mở trang định nghĩa để xem
      cảnh báo "role chưa có ai giữ".
- [ ] `make backup` chạy thành công và `BACKUP_DIR` trỏ ra **ngoài** host (ổ thứ hai hoặc thư mục
      đồng bộ).
- [ ] `make restore-drill` **PASS** sau lần thay đổi schema/backup gần nhất.
- [ ] Đã thử một quy trình thật từ đầu tới cuối trên môi trường này (chạy từ bản ghi → duyệt → hoàn
      tất) và thấy nó trong event log.
- [ ] `make pilot-logs` không có lỗi lặp lại; log xoay vòng theo compose.
- [ ] Đã biết ai gọi khi database hỏng, và lệnh phục hồi ở mục 5 đã được đọc một lần.

## 8. Sự cố thường gặp

| Triệu chứng | Nguyên nhân và cách xử lý |
| --- | --- |
| `api` không start, `migrate` exited(1) | Migration lỗi. `docker compose ... logs migrate` — migration đã áp dụng là bất biến, sửa bằng file migration mới |
| `/readyz` trả 503 | API không nối được DB: kiểm tra `postgres` healthy và `DATABASE_URL` trong `.env` |
| Đăng nhập xong bị đá về `/login` | Cookie `Secure` nhưng host chưa có HTTPS: đặt `API_ENV=development` tạm, hoặc dựng reverse proxy HTTPS rồi để `production` |
| `backup` log `permission denied` | Thư mục `${BACKUP_DIR}` không cho container ghi; job chạy bằng root trong container nên thường là do volume mount sai đường dẫn |
| Dump cũ không bị xoá | Retention chỉ chạy sau một lần ghi **thành công**; xem log `backup` |
| Web hiện "Không gọi được API" | `API_BASE_URL` trong service `web` phải là `http://api:21501` (mạng nội bộ compose), không phải localhost |
