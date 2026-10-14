# Deployment — one internal host (D10, ADR 0009)

Operator page: `docs/ops-runbook.md`. Decision and trade-offs: `docs/adr/0009-deployment-topology-and-backup.md`.
This memory holds only what is easy to get wrong when changing the deployment.

## Shape

- **One compose file, two modes** (`deployments/docker-compose.yml`): no profile = PostgreSQL only
  (`make docker-up`, local dev with `make dev` on the host); profile `pilot` = `migrate` → `api` →
  `web` → `caddy` → `backup` (`make pilot-up`). Do not split into two files: the two topologies must
  not drift.
- **Caddy is the only service published to the network** (`deployments/caddy/Caddyfile`): it terminates
  TLS for `OPVARYN_HOSTNAME` using Caddy's own CA (`tls internal`, the honest option for a hostname no
  public CA can validate), adds a few security headers and redirects HTTP→HTTPS. `api` and `web` bind
  to the host **loopback** only; the API is deliberately not routed, because the browser never calls it
  directly (BFF, ADR 0008). Its healthcheck speaks TLS to the served hostname via `extra_hosts`, so a
  broken handshake is unhealthy instead of silent. With TLS in front, `API_ENV=production` is safe to
  set (cookie `Secure`) — the runbook's section 3 explains installing the root CA on clients.
- Two images built from this repository, base images pinned by digest, both Dockerfiles watched by
  Dependabot: `apps/api/Dockerfile` (static Go binaries + `sql/`, non-root) and `apps/web/Dockerfile`
  (Next.js **standalone**; build context is the repository root because the app consumes the
  workspace `@opvaryn/contracts` package). `next.config.ts` sets `output: 'standalone'` for this;
  `apps/web/public/` exists (with a `.gitkeep`) so the image can copy it.
- `api` waits for the one-shot `migrate` service with `service_completed_successfully`. The migrate
  service **replaces the entrypoint** (`entrypoint: ['/app/migrate']`) — setting `command` would
  append to the image's server entrypoint and start a second API server instead of migrating.
- Node 26 images no longer ship corepack, so the web Dockerfile installs pnpm explicitly at the
  version mise.toml pins. Keep those two in step.

## Backup and restore (the part with a rule attached)

- A backup counts only when it has been restored: `scripts/backup-db.sh` writes a `-Fc` dump and
  re-reads it with `pg_restore --list` before reporting success; `scripts/restore-drill.sh`
  (`make restore-drill`) restores the newest dump into a scratch database, compares
  `schema_migrations` and the row counts of the main tables with the source, checks that instances
  still point at their record and definition version, then starts the API against the restored copy
  and signs in. Source DB is never written; the scratch DB is dropped even on failure.
- The backup job runs as root inside its own container on purpose (the dump directory is a bind
  mount owned by the host user); the retention prune runs only after a successful write.
- `BACKUP_DIR` should point at a second disk or a synced directory — a dump beside the database is
  not a backup. Secrets live in `.env` on the host, never in the repository.
- Cookie `Secure` follows `API_ENV != development`: put HTTPS in front before setting
  `API_ENV=production`, or browsers will not send the session cookie.

## CI

- The integration job builds both images (`make images-build`) after the smoke tests, so a broken
  Dockerfile fails the gate instead of the next deploy. Job names are part of the branch ruleset —
  do not rename them.
