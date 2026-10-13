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
