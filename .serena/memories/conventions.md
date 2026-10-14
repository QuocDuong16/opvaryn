# Conventions

## Go (`apps/api`)

- Layers: `internal/httpapi` (decode/encode HTTP) → `internal/service` (business rules) →
  `internal/store` (PostgreSQL). Handlers map between `domain` structs and generated `apiv1`
  types and contain no business rules.
- Validation belongs to the service and reports ALL problems at once
  (`service.ValidationError{Problems []string}`, joined with "; "). Handlers translate errors to
  stable codes: `invalid_request`(400), `conflict`(409), `service_unavailable`(503),
  `internal_error`(500). Clients switch on codes, never on messages.
- Store turns connectivity failures into `store.ErrUnavailable` (via `classify()`) and uniqueness
  violations into `store.ErrConflict`; handlers must map those, not string-match errors.
- Machine keys are lowercase snake_case, 2–64 chars (`service.KeyPattern`), mirrored in the
  OpenAPI `pattern` and a DB CHECK constraint — keep the three in sync.
- Comments state constraints the code cannot show; never narrate the change or restate the code.
- Logging via `log/slog`; text handler in development, JSON otherwise. Never log secrets or
  personal data.
- `internal/domain` holds only implemented entities. Adding a guessed entity or schema ahead of
  the workflow decisions is forbidden (see invariants in `mem:core`).
- Record values are validated in the service against the object's field definitions before the
  store sees them (`validateRecordValues`), because only the service knows the schema. The store
  owns persistence and constraint mapping, never business rules.
- Definition schemas are versioned and only grow (ADR 0006): create publishes v1, edit publishes
  the next version inside one transaction with the object row locked, and a published version is
  never updated. Records store the version they were created under and are always read with it —
  never re-render or rewrite old data with a newer schema. The version table is the single source
  of truth; do not reintroduce a fields column on the object row.
- The process engine follows ADR 0007: one transaction per decision with compare-and-swap on the
  task and the instance (the second caller gets 409, never a second transition), reject terminal,
  return resets to a new attempt, instances bound to the version they started with, every
  transition appended to `process_events`, and a task decidable only with its assigned role.
  Conditions are the JSON subset of D04 (eq/ne/gt/gte/lt/lte); anything richer needs a new ADR.
  What ADR 0007 lists as deferred (parallel/join, timers/SLA, subprocess, delegation, service
  actions, cancellation, context snapshots) must not appear as tables or endpoints.

## Web (`apps/web`)

- Server Components by default; `'use client'` only where interactivity requires it (active nav,
  forms). Keep client boundaries small.
- All API access goes through `lib/api/server.ts` (`createServerApiClient`); components never call
  the Go API directly. Mutations use server actions in `app/**/actions.ts` + `revalidatePath`.
- `'use server'` modules may export ONLY async functions — shared state/types live in a sibling
  module (established pattern: `components/objects/create-object-state.ts`).
- Theming: httpOnly cookie `opvaryn.theme`, read in the root layout (SSR-correct first paint) and
  written by the server action in `app/actions/theme.ts`. No localStorage / document.cookie
  (ESLint enforces this too).
- Styling: two-layer tokens in `app/globals.css` — raw CSS variables per `[data-theme]`, then
  `@theme inline` mapping to Tailwind utilities (`bg-surface-raised`, `text-on-surface-muted`,
  `border-border-strong`, `text-accent-strong`, …). Add tokens there; never hard-code hex.
- Navigation has a single source: `app/nav.ts` (`NAV_ITEMS`, `navItemFor`) drives sidebar, compact
  nav and breadcrumb. A new screen = nav entry + route + stage badge.
- Screens without real behavior use `components/ui/module-placeholder.tsx` and must declare a
  stage; real screens use `PageHeader` for the eyebrow/title/lead rhythm.
- Simulated surfaces keep typed fixtures next to their components (`components/<area>/demo-*.ts`)
  and put state transitions in pure modules (`*-reducer.ts`, `demo-metrics.ts`) that are unit
  tested; the screen labels each simulated part, and a fixture never pretends to be server data.
- Screens generated from a business object schema (entry form, record table, mini-app views)
  render from the definition; never hard-code the field list of a specific object.
- Never ship interactivity that does nothing: a control that cannot work yet is rendered
  disabled with an explanation (the Application Builder configuration tab). Toggles, drag handles
  or forms that silently discard input are not acceptable demo material.
- User configuration with no entity of its own lives in an httpOnly cookie written by a server
  action and read on the server (`opvaryn.theme`, `opvaryn.dashboard`). Reads stay lenient so a
  stale cookie still renders; writes are strict and reject rather than prune. The pure module
  owning the shape (e.g. `components/analytics/dashboard-layout.ts`) is unit tested and shared by
  the reader, the writer and the UI.
- Server-rendered dates/times use an explicit `timeZone` in `Intl.DateTimeFormat` for
  deterministic output.

## Compliance and CI

- Proprietary product: dependencies must be permissively licensed (MIT, BSD, Apache-2.0, ISC).
  Copyleft (GPL, LGPL, AGPL, SSPL) and source-available licences are rejected by the
  dependency-review workflow — do not add them by hand either.
- Workflows call Makefile targets instead of duplicating checks, and every `uses:` stays pinned by
  full commit SHA with a version comment.
- The repository is public but not open source; never import code or assets from other projects
  without a compatible licence, and keep the required-docs list in `scripts/check-docs.mjs` in sync.

## Docs, language, decisions

- User-facing copy and playbook/docs prose: Vietnamese. Agent instructions (`AGENTS.md`) and code
  comments: English.
- Cross-cutting decisions, and any deviation from playbook principles, get an ADR in `docs/adr/`
  (context / decision / consequences, Vietnamese) before or with the change.
- `AGENTS.md` is the binding working agreement; keep it accurate when conventions change.
