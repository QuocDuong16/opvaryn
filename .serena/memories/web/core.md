# apps/web — Next.js admin shell

## Routes and shell

- Routes follow the demo nav defined once in `app/nav.ts` (`NAV_ITEMS`, `navItemFor`):
  `/` overview, `/objects` (+ `/objects/[key]`), `/forms`, `/workflows`, `/tasks`, `/analytics`,
  `/apps`, `/settings`. `navItemFor` matches nested routes by longest prefix, so
  `/objects/it_incident` resolves to the Objects area.
- Root layout (`app/layout.tsx`) reads the theme cookie server-side, sets `data-theme` on
  `<html>` (no flash, no client theme script), loads Inter via `next/font`, and mounts
  `Sidebar` (lg+) / `Topbar` (breadcrumb + compact mobile nav + theme toggle).
- Theme plumbing: `lib/theme.ts` (`Theme`, `getTheme`, `nextTheme`, cookie `opvaryn.theme`,
  `DEFAULT_THEME = 'dark'`) + server action `app/actions/theme.ts`.
- `components/app-shell/nav.tsx` exports `SidebarNav` (desktop) and `CompactNav` (mobile), both
  client components using `usePathname`; `breadcrumb.tsx` resolves the current area via
  `navItemFor`.

## Demo screens (status per screen, ADR 0002/0003)

- `/` **live**: platform status from `/api/v1/meta` + `/readyz` in try/catch (never crashes when
  the API is off), plus a `DEMO_TOUR` grid that is the walkthrough entry point.
- `/objects` **live**: definition list (`object-list.tsx`, rows link to the detail page) and the
  create form with the schema editor.
- `/objects/[key]` **live**: field schema table, records table and the generated entry form;
  `params` is a Promise; a missing key calls `notFound()` (custom `not-found.tsx` in that
  segment).
- `/forms` **live** + concept list: object picker via `?object=key` (defaults to the first
  object), the same entry form as a preview, schema table, and the not-yet-built capabilities.
- `/workflows` **mock**: `WorkflowCanvas` (SVG graph, clickable/keyboard-selectable nodes,
  inspector) over `demo-definitions.ts`; read-only by design, and the page explains D05/D08.
- `/tasks` **mock**: `TaskInbox` reduces `demo-tasks.ts` through the pure `inbox-reducer.ts`
  (approve/reject/return/reset, reason required, only pending tasks can transition); no server
  call.
- `/analytics` **mock**: `DashboardStudio` picks metric/dimension/chart over `demo-metrics.ts`
  (`seriesFor`, `formatMetricValue`, `deltaBetween`); the save-layout button is disabled.
- `/apps` **mock + live**: `MiniApp` switches view — list/detail read live records, kanban groups
  by the first `select` field (mock policy), integration panel lists mock connectors. Status
  badges are per view, not per page.
- `/settings` **live**: endpoint table (kept in sync with the OpenAPI paths), ports, toolchain
  pins and the demo-data commands.

## Data access

- `lib/api/server.ts`: `createServerApiClient()` (base URL `API_BASE_URL` ??
  `NEXT_PUBLIC_API_BASE_URL` ?? `http://localhost:21501`) and `describeApiError()` mapping stable
  error codes to Vietnamese user messages. The client and all API types come from
  `@opvaryn/contracts` (generated; regenerate via `make contract-generate`).
- Server actions live in `app/**/actions.ts`. `app/objects/actions.ts` holds
  `createBusinessObjectAction` (parses the `fields` JSON hidden input the editor submits) and
  `createObjectRecordAction` (fetches the object, converts form strings via
  `components/forms/record-values.ts`, then posts; revalidates `/objects/[key]`, `/objects`,
  `/forms`, `/apps`).
- `'use server'` modules may export only async functions; shared state and pure helpers live in
  sibling modules (`components/objects/create-object-state.ts`,
  `components/forms/object-form-state.ts`, `components/forms/record-values.ts`,
  `components/objects/field-draft.ts`).
- `lib/format.ts`: `FIELD_TYPE_LABELS`, `formatTimestamp`, `formatDate` (no timezone shift),
  `formatFieldValue` (per field type), `primaryFieldValue` (the label that identifies a record).

## Schema-driven UI

- `components/objects/field-editor.tsx` (client) edits field rows and submits one JSON hidden
  input; `field-draft.ts` serializes drafts (`value = Nhãn` option lines, blank rows dropped,
  options only on select).
- `components/forms/object-form.tsx` (client) renders one control per field type from the
  definition (file fields are disabled with a warning; rows = one item per line) and remounts on
  success via `key={state.recordId}` so the next entry starts blank.
- `components/objects/record-list.tsx` and `field-schema.tsx` derive their columns from the
  definition, so changing an object changes the table without code changes.

## Styling and UI primitives

- Tokens: two layers in `app/globals.css` — raw CSS variables under `[data-theme='dark'|'light']`,
  then `@theme inline` mapping them to Tailwind color utilities. Dark is the default. Add tokens
  there; never hard-code hex in components.
- `components/ui/`: `status-badge.tsx` (mandatory `live`/`mock`/`concept` labeling with tooltips),
  `page-header.tsx` (eyebrow/title/lead/aside rhythm), `card.tsx`
  (`Card`/`CardTitle`/`CardDescription`), `module-placeholder.tsx` (kept for future
  not-yet-built modules; no route uses it any more).
- SVG diagrams and charts are hand-rolled (`stroke-*`/`fill-*` token classes); no chart or graph
  dependency was added for the demo.
- Icons: `@phosphor-icons/react` — server components MUST import
  `@phosphor-icons/react/dist/ssr`.

## Config and tests

- Dev/start ports are hardcoded in `apps/web/package.json` (`next dev --port 21500`).
  `next.config.ts` only sets `transpilePackages: ['@opvaryn/contracts']`.
- Tests in `apps/web/__tests__/`: `shell.test.tsx` (badge labels, nav integrity),
  `inbox-reducer.test.ts` (task transitions, no fixture mutation),
  `record-values.test.ts` (FormData → API values), `field-draft.test.ts` (editor serialization).
  Vitest aliases `@` → app root and sets `environment: 'jsdom'`; coverage has no thresholds yet.
- Verified end-to-end manually (no browser backend in this environment): the record form and the
  create-object form accept a replay of their progressive-enhancement multipart POST and produce
  a stored row/definition; validation and conflict messages surface in the form.
