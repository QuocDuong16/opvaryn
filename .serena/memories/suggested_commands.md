# Commands

All workflows are root Makefile targets; `make help` lists everything.

## Setup / run

- `mise install` → `pnpm install` → `cp .env.example .env` (optional; code has matching defaults)
  → `make docker-up` → `cd apps/api && go run ./cmd/migrate`.
- `make dev` runs API + web together; `make dev-api` / `make dev-web` separately. Web :21500,
  API :21501, PostgreSQL :21532.
- The migration command must run from `apps/api` — the runner's default `-dir` is `sql/migrations`
  relative to the working directory.
- Demo dataset: `make seed-demo` (needs the API running) seeds the three pilot objects
  (`purchase_request`, `it_incident`, `hr_onboarding`), publishes the three pilot definitions and
  starts one instance per process for the role that must act next. Idempotent; it warns and skips
  when an object already exists with a different schema.
- Accounts and departments: `make useradm ARGS="-create-department -key ky_thuat -department-name 'Kỹ thuật'"`,
  `make useradm ARGS="-create -email lan@opvaryn.local -name 'Lan' -password '...' -department ky_thuat -roles truong_bo_phan"`,
  `make useradm ARGS="-list"`, `make useradm ARGS="-set-password -email ... -password ..."`.
- Smoke tests: `curl -s localhost:21501/readyz` (also verifies the DB), `curl -s
  localhost:21501/api/v1/meta`.

## Quality

- `make quality-check` (full gate: api-check + web-check + docs-check), `make api-check`,
  `make web-check`, `node scripts/check-docs.mjs`, `make contract-generate`,
  `make contract-check`.
- `make api-fix` (go mod tidy + gofmt), `cd apps/web && pnpm format` (prettier --write).
- `make smoke-api` — builds, starts and smoke tests the API end-to-end (needs `make docker-up`
  and applied migrations; covers business objects, object records, validation errors and the 404
  envelope); `make seed-demo` — demo dataset; `make actions-lint` — actionlint over
  `.github/workflows`.
- `make smoke-demo-flows` — builds the API and the web app (production build), starts both, then
  replays the demo form server actions and verifies the stored rows and the saved dashboard
  layout. Requires `pnpm install` and a migrated database, and refuses to start while anything
  answers on 21500/21501 — stop dev servers first (`ss -ltnp` + kill by pid). It leaves
  `flow_*`/`flow_web_*` objects behind in a local database, like `smoke-api` leaves `smoke_*`.

## Database / infra

- `make docker-up | docker-down | docker-logs | docker-config | docker-clean`
  (compose file `deployments/docker-compose.yml`, project name `opvaryn`). Without a profile this
  starts PostgreSQL only, which is what local development needs.
- Deployment on one host (profile `pilot`, ADR 0009): `make images-build`,
  `make pilot-up | pilot-down | pilot-logs`. Backups: `make backup` (writes and re-reads a dump),
  `make restore-drill` (restores the newest dump into a scratch DB and proves the API signs in
  against it — run it after schema/backup changes and before a pilot). Operator guide:
  `docs/ops-runbook.md`.
- `make pilot-up` occupies 21500/21501/21532, so stop it before `make smoke-api` or
  `make smoke-demo-flows`, which refuse to start while those ports answer.

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
