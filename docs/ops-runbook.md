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
| `api` | Go service | Healthcheck `/readyz`; cổng `${API_PORT}` (mặc định 21501) **chỉ bind loopback** |
| `web` | Next.js standalone | Healthcheck `/`; cổng `${WEB_PORT}` (mặc định 21500) **chỉ bind loopback**; gọi API qua mạng nội bộ `http://api:21501` |
| `caddy` | TLS terminator + reverse proxy | **Service duy nhất mở ra mạng**: `${CADDY_HTTP_PORT}` (21580) và `${CADDY_HTTPS_PORT}` (21443) → `web:21500` |
| `backup` | Job `pg_dump` định kỳ | Vòng lặp `scripts/backup-db.sh`; dump ghi ra `${BACKUP_DIR}` |

`postgres` **không** thuộc profile `pilot`, nên `make docker-up` vẫn chỉ dựng Postgres cho dev.
API và web chỉ bind loopback: ops vào được từ chính host, còn mạng ngoài chỉ thấy Caddy.

## 2. Chuẩn bị host (một lần)

Chọn tên nội bộ cho host (`OPVARYN_HOSTNAME`, mặc định `opvaryn.local`) và **trỏ nó về máy chủ này**
trước khi bắt đầu: một bản ghi DNS nội bộ, hoặc `/etc/hosts` trên từng máy khách nếu chưa có DNS.
Caddy phát chứng chỉ cho đúng tên đó, nên tên không phân giải được thì không máy khách nào mở được
trang (và bước kiểm tra bên dưới cũng không chạy).

```bash
git clone <repo> /opt/opvaryn && cd /opt/opvaryn
cp .env.example .env          # rồi sửa, xem mục 3
mkdir -p /srv/opvaryn-backups # nơi chứa dump, xem mục 5
make images-build             # build image API + web
make pilot-up                 # migrate → api → web → caddy → backup
```

Kiểm tra (thay `opvaryn.local` bằng `OPVARYN_HOSTNAME` của bạn và thêm `:21443` nếu chưa đổi cổng;
`-k` vì CA nội bộ chưa được tin ở máy bạn, xem mục 3):

```bash
docker compose -f deployments/docker-compose.yml --profile pilot ps   # tất cả healthy, migrate exited(0)
curl -s localhost:21501/readyz                                       # {"status":"ok"} — API qua loopback
curl -sk -o /dev/null -w '%{http_code}\n' https://opvaryn.local:21443/   # 200 qua Caddy
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: opvaryn.local' http://localhost:21580/  # 308 → HTTPS
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
>
> Đặt tên hiển thị cho role để màn hình không in khoá máy (ADR 0016):
> `/app/useradm -set-role-label -role truong_bo_phan -label 'Trưởng bộ phận'`. Role chưa đặt tên
> vẫn dùng được — màn hình hiện khoá của nó.

## 3. HTTPS, bí mật và cấu hình

**HTTPS** do service `caddy` lo (ADR 0009). Caddy phát chứng chỉ cho `OPVARYN_HOSTNAME` từ **CA nội bộ
của chính nó** (`tls internal` trong `deployments/caddy/Caddyfile`), vì một hostname nội bộ không CA
công cộng nào xác thực được. Máy khách sẽ cảnh báo cho tới khi bạn cài root certificate:

```bash
# Lấy root CA của Caddy ra host
docker compose -f deployments/docker-compose.yml --profile pilot \
  cp caddy:/data/caddy/pki/authorities/local/root.crt ./opvaryn-root.crt
# Cài vào máy khách (Linux)
sudo cp opvaryn-root.crt /usr/local/share/ca-certificates/opvaryn-root.crt && sudo update-ca-certificates
```

Khi host đã có tên phân giải công khai và muốn chứng chỉ thật: bỏ dòng `tls internal` trong
Caddyfile (Caddy sẽ tự xin Let's Encrypt).

Cổng publish mặc định **21580/21443** để không đụng project khác trên máy dùng chung (quy ước 21xxx
của repo). Trên host nội bộ riêng, đặt `CADDY_HTTP_PORT=80` và `CADDY_HTTPS_PORT=443` trong `.env`
để người dùng không phải gõ cổng trong URL.

> Với cổng mặc định, hãy chia sẻ URL **kèm cổng**: `https://<OPVARYN_HOSTNAME>:21443`. Caddy chuyển
> `http://<tên>:21580` sang `https://<tên>/` — tức cổng 443 — vì nó không biết cổng publish bên
> ngoài; chỉ khi đặt 80/443 thì URL không cổng mới đúng.

- Mọi cấu hình nằm trong `.env` trên host (đã bị `.gitignore`). **Không** commit `.env`, không đặt
  bí mật vào `NEXT_PUBLIC_*`.
- Bắt buộc đổi trước khi chạy thật: `POSTGRES_PASSWORD` (mật khẩu DB) và mật khẩu các tài khoản tạo
  bằng `useradm`. Mật khẩu demo trong repo chỉ dành cho máy local.
- `API_ENV=production`: session cookie chỉ được đặt `Secure` khi API không ở development (ADR 0008).
  Với Caddy đứng trước, HTTPS đã có nên đặt `production` được — nhớ đổi cả
  `CORS_ALLOWED_ORIGINS=https://<OPVARYN_HOSTNAME>`; nếu vẫn để `development` thì cookie không có
  cờ `Secure` và trình duyệt sẽ gửi nó qua cả HTTP.
- API và web **chỉ bind loopback**: đừng thêm publish `0.0.0.0` cho chúng, mọi truy cập từ mạng phải
  đi qua Caddy.
- Tích hợp webhook ra ngoài (ADR 0012) bật bằng `OPVARYN_WEBHOOK_URL` và `OPVARYN_WEBHOOK_SECRET`
  trong `.env`; URL để trống là tắt, và đó là mặc định. Lịch sử gửi (kể cả lần thử lại) xem ở trang
  Cài đặt của web, hoặc `GET /api/v1/webhook-deliveries`.

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

Trên môi trường dev, các lần chạy `make smoke-*` để lại object, định nghĩa, instance và tài khoản
thử nghiệm; sau một ngày chúng đủ để màn Dữ liệu chỉ còn là rác. `make clean-smoke-data` xoá đúng
những dòng do smoke tạo (tiền tố `smoke_`/`flow_`/`restart_` và địa chỉ `*@example.com`) và không
đụng dữ liệu pilot. Ba script smoke tự gọi bước này trước khi chạy, nên chạy tay chỉ cần khi bạn
muốn dọn ngay. Chạy `make backup` trước nếu muốn có đường lùi.

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
- [ ] `make smoke-restart` **PASS** trên môi trường này: state sống trong PostgreSQL, nên restart
      (kể cả crash) không mất việc đang chờ và retry không áp dụng quyết định hai lần.
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
