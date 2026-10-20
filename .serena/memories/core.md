# OPVARYN — top-level map

Business Operations Platform. This repository implements the **interactive demo** (8-week plan,
playbook page `demo-mvp.html`) and then **MVP V1** on the same codebase (ADR 0005–0009). The demo
screens and the main MVP surfaces all exist (workflow designer, live inbox, instance lists,
deployment with a tested restore). What is left: analytics read models (blocked on **D06**, the one
open playbook decision), OIDC when the organisation has an IdP, and drag-and-drop on the canvas.

## Layout

- `apps/api` — Go modular monolith (HTTP + PostgreSQL). Layer/paths detail: `mem:api/core`.
- `apps/web` — Next.js App Router admin shell (demo screens). Detail: `mem:web/core`.
- `packages/contracts` — TypeScript types generated from OpenAPI + typed API client
  (`createApiClient`, `ApiError`).
- `deployments/docker-compose.yml` — two modes in one file: PostgreSQL only for local dev, and the
  whole product under the `pilot` profile (migrate → api → web → backup). Images and the restore
  drill: `mem:deployment`, operator page `docs/ops-runbook.md`.
- `operations-playbook/` — requirements source: standalone offline HTML notebook, NOT code.
- `docs/adr/` — decisions binding for this repository (0001 stack, 0002 demo scope + labels,
  0003 demo data slice + mock surfaces, 0004 dashboard layout storage + demo-flow tests).
  0005 is **Accepted**: the owner settled D04/D05/D08 (self-built runtime on PostgreSQL, JSON
  conditions, reject terminal / return resets, role resolver). 0006 is definition versioning +
  publish; 0007 is the process execution contract the runtime implements; 0008 settles D09a/D09b
  (local auth with an OIDC seam, RBAC + department scope), D07 (pilot: purchase request, IT
  incident, HR onboarding) and D10 (single internal host with Docker Compose).
- `scripts/` — quality gates (`check-docs.mjs`), `smoke-api.sh` (end-to-end API smoke test),
  `smoke-demo-flows.sh` (web flows: builds both servers, replays the demo forms),
  `seed-demo.sh` (idempotent demo dataset through the public API) and `playbook-rename.py`
  (doc maintenance). `clean-smoke-data.sh` removes what a smoke run left behind: the three smoke
  scripts call it **before** a run (so a failed run's evidence stays) and after one that passed,
  and `make clean-smoke-data` runs it by hand. It needs **bash**, not sh — its compose invocation
  is an array, and a caller using `sh` gets a syntax error that a swallowed exit status hides.
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
- The workflow runtime exists since the owner settled D04/D05/D08 (ADR 0005): self-built on
  PostgreSQL, JSON conditions, reject terminal / return resets, role resolver. Its contract is
  ADR 0007 and `mem:conventions` lists the invariants that must not be broken. What ADR 0007 marks
  as deferred stays out until its own ADR.
- Every screen/feature declares a stage via `StatusBadge`: `live` (real API+DB), `mock`
  (simulated), `concept` (vision). ADR 0002; where a screen mixes live and simulated parts,
  each part is labeled (ADR 0003).
- Live slices are business object definitions and their records (schema → generated form →
  service validation → JSONB), including a record's own screen with edit/delete under the write
  rule (ADR 0023), CSV export (ADR 0024) and import (ADR 0026), file attachments (ADR 0025), the
  per-field change history (ADR 0027) and the sign-in cooldown (ADR 0028), sign-in/permissions
  (ADR 0008), organisation administration
  (`/admin` + `/api/v1/admin/*`: users, departments, the role catalogue — ADR 0022) and the task
  inbox with its approve/return/reject decisions (ADR 0007). Still fixtures: the workflow designer screen,
  Analytics numbers and the kanban/connector panels (ADR 0003, updated 2026-10-14).
- Applied migrations are immutable: the runner verifies sha256 per version and refuses a changed
  file. A feature adds a new migration; it never edits an applied one.
- Local ports are fixed in the 21xxx range — web 21500, API 21501, PostgreSQL 21532, and the pilot
  stack's TLS terminator 21580/21443 — chosen to avoid collisions with the sibling projects in
  `~/Workspace`. Every published port, including anything new, stays in that range unless the owner
  says otherwise; a dedicated host can move Caddy to 80/443 in `.env`.
- `operations-playbook/` is a document. Change it only as an explicit doc change (see
  `mem:suggested_commands` for the script), never as a side effect of code work.
- Sibling repos in `~/Workspace/nian-*` are a larger, more mature ecosystem; this repo mirrors
  their toolchain and quality-gate conventions, not their feature scope.
- Hosted on GitHub with GitHub Actions CI: `.github/workflows/` mirrors `make quality-check` plus
  an integration job (migrate + `make smoke-api`). Do not add `renovate.json` or `.forgejo/` —
  that is sibling-repo tooling; dependency updates come from Dependabot (`.github/dependabot.yml`).

Working rules: `mem:conventions` before writing code; `mem:task_completion` before declaring a
task done; `mem:tech_stack` for pins and dependencies; `mem:suggested_commands` to run things.
