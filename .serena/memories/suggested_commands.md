# Commands

All workflows are root Makefile targets; `make help` lists everything.

## Setup / run

- `mise install` → `pnpm install` → `cp .env.example .env` (optional; code has matching defaults)
  → `make docker-up` → `cd apps/api && go run ./cmd/migrate`.
- `make dev` runs API + web together; `make dev-api` / `make dev-web` separately. Web :21500,
  API :21501, PostgreSQL :21532.
- The migration command must run from `apps/api` — the runner's default `-dir` is `sql/migrations`
  relative to the working directory.
- Smoke tests: `curl -s localhost:21501/readyz` (also verifies the DB), `curl -s
  localhost:21501/api/v1/meta`.

## Quality

- `make quality-check` (full gate: api-check + web-check + docs-check), `make api-check`,
  `make web-check`, `node scripts/check-docs.mjs`, `make contract-generate`,
  `make contract-check`.
- `make api-fix` (go mod tidy + gofmt), `cd apps/web && pnpm format` (prettier --write).
- `make smoke-api` — builds, starts and smoke tests the API end-to-end (needs `make docker-up`
  and applied migrations); `make actions-lint` — actionlint over `.github/workflows`.

## Database / infra

- `make docker-up | docker-down | docker-logs | docker-config | docker-clean`
  (compose file `deployments/docker-compose.yml`, project name `opvaryn`).

## Linux / process notes

- Find dev servers: `ss -ltnp | grep -E '2150[01]|21532'`.
- Kill dev servers by PID (from `ss`). Do NOT use `pkill -f` with patterns like `next start` or a
  binary path: the pattern also matches the invoking shell's own command line and kills your
  shell mid-command.
- The repo is a git repository without commits so far; `git status --porcelain` shows the tree as
  untracked until the first commit.

## Playbook maintenance

- `python3 scripts/playbook-rename.py` — the naming pass that aligned `operations-playbook/` with
  the OPVARYN name. Idempotent: it asserts expected occurrence counts and aborts on mismatch, so
  it is safe (and inert) to re-run after the rename was applied.
- Playbook HTML has no build step; after editing verify structure with a tag-balance check and
  `node --check operations-playbook/app.js`.
