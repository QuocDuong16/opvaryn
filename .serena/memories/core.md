# OPVARYN — top-level map

Business Operations Platform. This repository implements the **interactive demo** (8-week plan,
playbook page `demo-mvp.html`), not MVP V1.

## Layout

- `apps/api` — Go modular monolith (HTTP + PostgreSQL). Layer/paths detail: `mem:api/core`.
- `apps/web` — Next.js App Router admin shell (demo screens). Detail: `mem:web/core`.
- `packages/contracts` — TypeScript types generated from OpenAPI + typed API client
  (`createApiClient`, `ApiError`).
- `deployments/docker-compose.yml` — local PostgreSQL 18 only (image pinned by digest).
- `operations-playbook/` — requirements source: standalone offline HTML notebook, NOT code.
- `docs/adr/` — decisions binding for this repository (0001 stack, 0002 demo scope + labels,
  0003 demo data slice + mock surfaces, 0004 dashboard layout storage + demo-flow tests).
- `scripts/` — quality gates (`check-docs.mjs`), `smoke-api.sh` (end-to-end API smoke test),
  `smoke-demo-flows.sh` (web flows: builds both servers, replays the demo forms),
  `seed-demo.sh` (idempotent demo dataset through the public API) and `playbook-rename.py`
  (doc maintenance).
- `.github/` — CI (`workflows/`: quality gate, integration smoke, CodeQL, dependency review),
  `dependabot.yml`, `CODEOWNERS`, issue/PR templates; these templates are the Vietnamese/English
  forms users see, keep them honest.
- Legal and policy documents at the root: `LICENSE.md` (proprietary, no-copy/no-commercial),
  `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`; the required-docs list lives in
  `scripts/check-docs.mjs`.
- Root: `Makefile` (entry point for every workflow), `mise.toml` + committed `mise.lock`,
  `pnpm-workspace.yaml` (workspace + install-script allowlist), `AGENTS.md` (binding rules),
  `.env.example` (all knobs; code has matching defaults so `.env` is optional),
  `.editorconfig` and `.gitattributes`.

## Invariants

- `apps/api/openapi/openapi.yaml` is the single contract source. Go types
  (`apps/api/internal/api/v1/types.gen.go`) and TS types
  (`packages/contracts/src/generated/schema.ts`) are generated and committed; never hand-edit
  them; regenerate with `make contract-generate`.
- Workflow runtime is deliberately absent: no process/task/event tables, no approval state
  machine, until playbook decisions D05/D08 (Process Execution Contract) are settled. Do not
  implement it speculatively; `domain` holds only implemented entities.
- Every screen/feature declares a stage via `StatusBadge`: `live` (real API+DB), `mock`
  (simulated), `concept` (vision). ADR 0002; where a screen mixes live and simulated parts,
  each part is labeled (ADR 0003).
- Live slices are business object definitions and their records (schema → generated form →
  service validation → JSONB). Workflow/Task/Analytics screens and kanban/connector panels are
  typed fixtures with no runtime and no process/task/event tables (ADR 0003).
- Applied migrations are immutable: the runner verifies sha256 per version and refuses a changed
  file. A feature adds a new migration; it never edits an applied one.
- Local ports are fixed in the 21xxx range — web 21500, API 21501, PostgreSQL 21532 — chosen to
  avoid collisions with the sibling projects in `~/Workspace`.
- `operations-playbook/` is a document. Change it only as an explicit doc change (see
  `mem:suggested_commands` for the script), never as a side effect of code work.
- Sibling repos in `~/Workspace/nian-*` are a larger, more mature ecosystem; this repo mirrors
  their toolchain and quality-gate conventions, not their feature scope.
- Hosted on GitHub with GitHub Actions CI: `.github/workflows/` mirrors `make quality-check` plus
  an integration job (migrate + `make smoke-api`). Do not add `renovate.json` or `.forgejo/` —
  that is sibling-repo tooling; dependency updates come from Dependabot (`.github/dependabot.yml`).

Working rules: `mem:conventions` before writing code; `mem:task_completion` before declaring a
task done; `mem:tech_stack` for pins and dependencies; `mem:suggested_commands` to run things.
