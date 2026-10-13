# AGENTS.md

Working agreement for agents and contributors in this repository.

## Project context

- OPVARYN is a business operations platform: organizations define their own data,
  workflows, applications and reports instead of buying a separate tool per process.
- This repository currently targets the **interactive demo** described in
  `operations-playbook/demo-mvp.html` (8 week plan), not the MVP V1. Demo screens may
  simulate future functionality but must be labeled `live`, `mock`, or `concept`.
- The operations playbook (`operations-playbook/`) is the requirements source. Read the
  relevant page before implementing scope. It is a strategy document: treat its estimates
  as provisional, its principles as binding.
- Product and technical decisions still open are tracked in
  `operations-playbook/decisions.html` (D01–D10). Do not silently pick a direction that
  contradicts an open decision; ask instead.
- Demo surfaces and their status are fixed by ADR 0002 and ADR 0003: business object
  definitions and records are `live`; form entry is generated from the schema and validated
  by the Go service; workflow, task inbox, analytics and kanban/connector panels are
  `mock` fixtures with no runtime; conditional visibility, calculated fields and escalation
  are `concept`.

## Working agreement

- Read the relevant source, contract (`apps/api/openapi/openapi.yaml`) and ADRs before
  changing behavior. Keep changes scoped.
- Prefer simple, explicit code and established project patterns. Avoid unrelated cleanup,
  new dependencies, and broad refactors.
- Add tests for important business and security behavior, including rejected input.
- Backend checks: `make api-check`. Frontend checks: `make web-check`. Full gate:
  `make quality-check`. End-to-end behaviour: `make smoke-api` (needs Postgres running and
  migrations applied). Demo dataset: `make seed-demo`. Report checks that were not run or
  failed.

## Architecture boundaries

- Modular monolith: `apps/api` is one deployable Go service with explicit internal
  boundaries (handlers decode HTTP, services apply rules, repositories persist).
  Do not introduce a second service without an ADR.
- The OpenAPI document is the single source of truth for the HTTP contract. Generated Go
  types (`apps/api/internal/api/v1/types.gen.go`) and TypeScript types
  (`packages/contracts/src/generated/schema.ts`) are committed; regenerate with
  `make contract-generate`, never edit them by hand.
- The backend owns validation, permissions and business rules. Frontend checks are for
  display and navigation only. Record values are validated against the object's field
  definitions in `internal/service` before they are stored; the web form never decides
  whether input is valid.
- Workflow runtime is stubbed until the process execution contract is decided
  (see `operations-playbook/architecture.html` section 04). Do not implement approval or
  state-machine behavior beyond explicit demo scope, and do not add process, task or event
  tables ahead of those decisions (ADR 0002, ADR 0003).

## Backend and security

- Return typed application errors with stable codes; never leak SQL, filesystem or stack
  details to clients.
- Validate input at the API boundary. Use `context` and timeouts for request-scoped I/O.
- Never log credentials, tokens or personal data. Do not swallow errors.

## Database and data safety

- Storage is PostgreSQL. Dynamic payloads are JSONB, but every field that is filtered,
  joined or measured gets a typed projection or read model.
- `business_object_records.values` is the JSONB payload of one record, keyed by field key and
  validated in the service against the object's definition before insert. Editing a schema
  after records exist (and migrating those values) is not part of the demo.
- Every schema change is a new deterministic migration in `apps/api/sql/migrations/`.
  Never edit a migration that has been applied anywhere.
- A published process definition version is immutable; instances keep the version they
  started with.

## Frontend

- Next.js App Router with Server Components by default; keep client boundaries small and
  explicit (`'use client'` only where interaction requires it).
- All API calls go through the shared client in `lib/api/`. Never fetch the Go API
  directly from components.
- Follow the design tokens in `apps/web/app/globals.css` (two-layer: raw CSS variables →
  `@theme inline` mapping). Never hard-code hex colors in components.
- Every screen that shows simulated behavior must render a status badge from
  `components/ui/status-badge.tsx` with `live`, `mock`, or `concept`. When a screen mixes
  live data with simulated parts, label each part (the Application showcase labels views,
  not the whole page).
- Demo fixtures for simulated surfaces live beside their components
  (`components/workflows/demo-definitions.ts`, `components/tasks/demo-tasks.ts`,
  `components/analytics/demo-metrics.ts`). Keep them typed, keep their state transitions in
  pure modules that are unit-tested, and never let a fixture pretend to be server data.
- Screens that generate UI from a business object schema (record form, record table, mini-app
  views) must render from the definition, not from hard-coded field lists.

## Docker and operations

- `deployments/docker-compose.yml` runs local Postgres only. Pin images by digest; do not
  use `latest`.
- Keep ports in the 21xxx range (documented in `.env.example`) to avoid collisions with
  other local projects.

## CI and compliance

- CI is GitHub Actions. It runs the same local gate (`make quality-check`) plus an integration
  job that applies migrations and runs `make smoke-api` against PostgreSQL. Workflows call
  Makefile targets and stay in sync with them — do not re-implement checks inline in a workflow.
- `actionlint` is part of `quality-check`; a workflow change that fails it fails the gate.
- Actions stay pinned by full commit SHA with a version comment; Dependabot updates them.
- OPVARYN is proprietary, non-commercial software (`LICENSE.md`). New dependencies must be
  permissively licensed (MIT, BSD, Apache-2.0, ISC). Copyleft (GPL, LGPL, AGPL, SSPL) and
  source-available licences are rejected by the dependency-review workflow and must not be added
  by hand either; ask before adding a dependency whose licence is unclear.
- Never put secrets, tokens or personal data into the repository, workflows or logs; CI uses the
  GitHub-provided token only.
- Security problems go through private advisories (`SECURITY.md`), never public issues. The
  repository is public but not open source: do not copy code or assets from other projects into
  it without a compatible licence.
- The required-docs list lives in `scripts/check-docs.mjs`; moving or renaming a top-level
  document (README, LICENSE, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, AGENTS) means updating it.

## Documentation and decisions

- Keep README, `.env.example` and docs accurate when behavior changes.
- Record durable cross-cutting decisions as concise ADRs in `docs/adr/` with context,
  decision, rationale and consequences. Deviations from the playbook's principles deserve
  an ADR as well.

<!-- SERENA:START -->

## Codebase navigation with Serena

Serena MCP is the primary tool for understanding and navigating this repository.

Before manually exploring source code:

1. Use Serena memories to recover stable project context when relevant.
2. Use Serena semantic tools to locate symbols, references, implementations, and file-level symbol overviews.
3. Use Serena to narrow the task to the smallest relevant set of symbols/files.
4. Read the actual source for the symbols being changed or where implementation details must be verified.
5. Treat source code as authoritative; Serena memories and indexes are navigation/context aids.

Prefer Serena for:
- symbol lookup
- references and callers
- implementations
- symbol/file overviews
- architecture exploration
- locating relevant tests
- semantic code navigation

Do not:
- scan the repository tree manually before trying Serena
- use grep/find/ripgrep for code-symbol discovery when Serena can answer it
- reread broad areas of the codebase that are already covered by Serena memories
- use OpenWiki or generated wiki documentation for codebase understanding

Fallback to normal file/search tools only when:
- Serena cannot resolve the target
- the target is non-code content not represented by the language server
- exact text search is specifically required
- Serena results appear stale or incomplete

When modifying code, always verify the relevant implementation in source before editing.

## Serena memories

- Read `mem:core` first when broader project context is needed.
- Follow referenced memories progressively; do not load all memories by default.
- Treat Serena memories as maintained project knowledge, not task logs or generated documentation.
- Store only stable, non-obvious knowledge that would otherwise require meaningful rediscovery from the codebase.
- Prefer updating an existing relevant memory over creating a new one.
- Create a new memory when durable project knowledge has no appropriate existing home.
- Do not store transient task details, exact dependency versions, or line-level implementation facts in memories.
- Source code remains authoritative if a memory and implementation disagree.

## Serena memory maintenance

After making a code or configuration change, explicitly review whether the completed work changes durable project knowledge.

Update Serena memories when the change:
- makes an existing memory inaccurate or incomplete
- introduces new stable architecture or component boundaries
- introduces or changes project-wide conventions
- changes build, test, development, deployment, or operational workflows
- changes authentication or authorization invariants
- introduces important integration behavior or cross-component contracts
- introduces persistent operational assumptions
- establishes other stable, non-obvious knowledge that future agents would otherwise need to rediscover

Do not update memories for:
- routine dependency/version bumps
- lockfile changes
- formatting or mechanical refactors
- isolated bug fixes whose behavior is obvious from the code
- one-off implementation details
- transient task state
- facts that can be trivially recovered from a single source file

Before considering a task complete:

1. Check whether any Serena memory used during the task is now inaccurate or incomplete.
2. Check whether the implementation introduced durable project knowledge not currently represented in Serena memories.
3. Update the relevant existing memory when appropriate.
4. Create a new memory only when the knowledge is durable and no existing memory is an appropriate home.
5. If no durable project knowledge changed, do not write a memory merely to record that the task occurred.

A task is not complete if it leaves relevant Serena memories materially inconsistent with the implemented code.

<!-- SERENA:END -->