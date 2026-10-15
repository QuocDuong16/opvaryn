# apps/web — Next.js admin shell

## Routes and shell

- Routes: `/` is the **public front page** and `/login` the sign-in screen; both stand outside the
  workspace frame (ADR 0014). Every screen behind the sign-in lives in the `app/(workspace)` route
  group — `/overview` (workspace home), `/objects` (+ `/objects/[key]`), `/forms`, `/workflows`
  (+ `[key]`), `/tasks` (+ `[instanceId]`), `/analytics`, `/apps`, `/roadmap`, `/settings` — and the
  group's `layout.tsx` carries the shell. `proxy.ts` (Next 16's name for middleware; `middleware.ts`
  is deprecated) sends a caller without the session cookie to `/login?next=<path>`; the API still
  validates the token on every call, so a stale cookie reaches the screen and the screen says it
  could not read (ADR 0008). Components import server actions by their real path, e.g.
  `@/app/(workspace)/objects/actions`.
- `app/nav.ts` (`NAV_ITEMS`, `navItemFor`) holds the **workspace** nav only: no `/` and no `/login`;
  `index` values stay sequential and the shell test enforces both. `navItemFor` matches nested routes
  by longest prefix, so `/objects/it_incident` resolves to the Objects area.
- Root layout (`app/layout.tsx`) reads the theme cookie server-side, sets `data-theme` on `<html>`
  (no flash, no client theme script) and loads **Be Vietnam Pro** via `next/font` — subsets
  `latin` + `vietnamese`, weights 400/500/600 only, because the face is static on Google Fonts and
  the interface uses just `font-medium` and `font-semibold` (add a weight in the layout before using
  a heavier one). It exposes `--font-be-vietnam-pro`, which `globals.css` maps into `--font-sans`;
  `font-mono` stays the system monospace stack. The shell itself (`Sidebar`
  lg+ / `Topbar` with breadcrumb, stage chip and compact mobile nav, plus the footer) lives in
  `(workspace)/layout.tsx`. The session cookie name/options live in `lib/session-cookie.ts` — no
  `next/headers` import, so the edge proxy can name the cookie — and `lib/session.ts` re-exports
  them. `lib/stage.ts` maps the API build stage to a label, passing unknown stages through.
- Theme plumbing: `lib/theme.ts` (`Theme`, `getTheme`, `nextTheme`, cookie `opvaryn.theme`,
  `DEFAULT_THEME = 'dark'`) + server action `app/actions/theme.ts`.
- `components/app-shell/nav.tsx` exports `SidebarNav` (desktop) and `CompactNav` (mobile), both
  client components using `usePathname`; `breadcrumb.tsx` resolves the current area via
  `navItemFor`.

## Screens (status per screen, ADR 0002/0003)

- `/` **live**: platform status from `/api/v1/meta` + `/readyz` in try/catch (never crashes when
  the API is off), then `SURFACES` (each screen with the label it earns), a "Chưa có trong V1"
  list and the label legend. This page describes the product, not the demo milestone that built
  it. Labels must be true in both directions: a live screen is never badged `mock`, and a screen
  that could not read the API carries no badge at all — an error is not simulated behaviour.
- `/objects` **live**: definition list (`object-list.tsx`, rows link to the detail page) and the
  create form with the schema editor.
- `/objects/[key]` **live**: version badge, field schema table, version history table, records
  grouped by definition version and the generated entry form, plus `UpdateObjectForm` which
  publishes the next version (schema editor prefilled with the current fields). `params` is a
  Promise; a missing key calls `notFound()` (custom `not-found.tsx` in that segment).
- `/forms` **live** + concept list: object picker via `?object=key` (defaults to the first
  object), the same entry form as a preview, schema table, and the not-yet-built capabilities.
- `/workflows/[key]` is a **drag-and-drop canvas editor** over a browser-local draft (ADR 0013):
  `components/workflows/workflow-editor.tsx` (client) moves nodes by pointer, connects by dragging the
  handle, deletes edges by clicking them, and offers keyboard paths (arrows nudge, Delete removes, the
  inspector's "Nối tới node khác" connects). `definition-draft-model.ts` is the pure, tested model
  (`draftFromGraph`, `moveNode`, `addNode`, `connectNodes`, `removeNode`, `draftGraph` — positions are
  dropped at publish, so dragging is not an unpublished change). The draft lives in the cookie
  `opvaryn.workflow_draft.<key>` behind `saveWorkflowDraftAction` (`lib/workflow-draft.ts`); publishing
  clears it. **Never** let a draft reach the engine: the API only knows published versions, and
  smoke-demo-flows flow H asserts the published definition is byte-identical while a draft exists.
- `/workflows` **live**: lists definitions from the API and creates new ones (`CreateDefinitionForm`);
  `/workflows/[key]` draws the published graph with `ProcessCanvas`, shows the version history
  (`?version=n` inspects an older version), the instances of that definition, and publishes the next
  version (`PublishDefinitionForm`). The fixture (`demo-definitions.ts`, `workflow-canvas.tsx`) is
  gone. Pure, tested modules: `components/workflows/definition-layout.ts` (column layout by distance
  from start, `conditionSummary`, `nodeSubtitle`, `outgoingEdges`) and `definition-draft.ts` (node/edge
  rows ↔ API graph, condition literal typed by the bound object's field, `serializeGraph`/`parseGraph`
  for the hidden input). Publishing stays the only write to a definition: an older version is rendered
  read-only with `ProcessCanvas`, and every edit happens on the browser-local draft described above
  (ADR 0013).
- `/objects/[key]` also carries `StartInstanceForm` (only definitions bound to that object are
  offered — conditions read its fields) and `InstanceList` for its records, backed by
  `listProcessInstances({objectKey})`; `/workflows/[key]` reuses `InstanceList` with
  `{definitionKey}` and passes `recordLabels` (built per object from `listObjectRecords` +
  `listBusinessObjectVersions`) so a row names the record it runs on — the label uses each record's
  own definition version (`components/objects/record-labels.ts`, `fieldsForVersionNumber`).
  `components/process/instance-list.tsx` is the shared row view (record, state, definition version ·
  attempt, current node, who holds it up).
- Roles in the designer come from `GET /api/v1/roles` (roles at least one user holds):
  `/workflows` feeds them to the editor's datalist, and `/workflows/[key]` warns when a definition
  names a role nobody holds — a valid definition whose instance would stop at that node and appear in
  no inbox. Keep that warning: it is the difference between a pilot that stalls silently and one that
  says why.
- `/tasks` **live**: the inbox is `GET /api/v1/tasks` read through `createServerApiClient()` (open
  tasks of the roles the signed-in user holds; no session → a sign-in card). `/tasks/[instanceId]`
  shows the instance, its tasks and its event log, and renders the record with the definition
  version it carries (fetched via `listBusinessObjectVersions` + `listObjectRecords`). The fixture
  inbox (`demo-tasks.ts`, `inbox-reducer.ts`, `task-inbox.tsx`) was deleted with the mock; SLA and
  escalation stay as a labelled `concept` note on the page. `components/tasks/task-timeline.ts` is
  the pure, tested module (event labels + `describeEvent` detail extraction, `openTasksForUser`,
  `nextTasks`); `decision-form.tsx` (client) posts `app/tasks/actions.ts`
  (`decideProcessTaskAction`). Each submit button carries its own `name="decision"` value, which
  both a JS submit and a plain HTML POST include — the role, reason requirement and
  compare-and-swap stay in the Go service.
- `/analytics` **live**: metric definitions come from `GET /api/v1/metrics`, and the page answers
  each one server-side (`getMetricResult`) before rendering, so a number is always scoped to the
  signed-in user (ADR 0008) — say that out loud, it is a feature. `DashboardStudio` draws the saved
  layout: one widget per metric key with a total, "trên N bản ghi bạn được đọc", and a breakdown of
  bars in the `bars` view; drag/↑↓/resize/remove plus **Lưu bố cục**. `components/analytics/
  create-metric-form.tsx` creates metrics from the object's own fields. The fixture
  (`demo-metrics.ts`) is deleted; `dashboard-layout.ts` was rewritten around `{id, metricKey, view,
  span}` and now **takes the allowed metric keys as a parameter** (metrics are server data, so the
  module must not import a catalog) — keep that shape. Layout storage is unchanged: the
  `opvaryn.dashboard` httpOnly cookie through `app/analytics/actions.ts` (`lib/dashboard.ts`;
  ADR 0004). Process-time metrics (cycle time, SLA) are listed as `concept`.
- `/apps` **mock + live**: `MiniApp` switches view — list/detail read live records, kanban groups
  by the first `select` field (mock policy), `Cấu hình` is the administration preview (concept:
  every control is disabled and the copy says nothing is stored), integration panel lists mock
  connectors. Status badges are per view, not per page.
- `/roadmap` **concept**: the playbook roadmap as a screen (four phases, MVP acceptance criteria,
  non-goals, resourcing estimates). `OPEN_DECISIONS` is empty (every playbook decision D04–D10 is
  settled) and `DECIDED` maps each to its ADR — keep both in step with `docs/adr/`; the
  MVP-acceptance note states that criteria 1–4 and 6 are met, plus 5 and 7 through the outbound
  webhook and `make smoke-restart`.
- `/settings` **live**: endpoint table (kept in sync with the OpenAPI paths), ports, toolchain pins,
  the demo-data commands, and the **webhook delivery log** (enabled/off, status, attempts, last error)
  with its own try/catch so a missing role or a stopped API only greys that card.
- `/analytics` also carries the operational read model (ADR 0011): a GET form filters by process and
  window, and the KPI cards show instances, cycle time, step time, approval rate and rework rate.
  `components/analytics/process-metrics.ts` (pure, tested) owns the formatting — keep durations and
  rates rendered there, and keep "chưa có dữ liệu" for an absent rate instead of a zero.

## Data access

- `lib/api/server.ts`: `createServerApiClient()` (base URL `API_BASE_URL` ??
  `NEXT_PUBLIC_API_BASE_URL` ?? `http://localhost:21501`) and `describeApiError()` mapping stable
  error codes to Vietnamese user messages. The client and all API types come from
  `@opvaryn/contracts` (generated; regenerate via `make contract-generate`).
- Sign-in is a BFF: the form (`app/login/page.tsx` + `components/auth/login-form.tsx`) posts
  `loginAction`, which calls the API and stores the returned token in the web app's own httpOnly
  cookie (`lib/session.ts`, `SESSION_COOKIE = 'opvaryn.session'`). `createServerApiClient` forwards
  that token as a Cookie header, so the browser never holds it and no component fetches the API
  directly. `components/auth/session-summary.tsx` is the topbar widget and fails soft.
  Useful for scripts: the cookie name matches the API's, and cookies ignore ports, so a session
  obtained from the API on :21501 is also accepted by the web app on :21500.
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
- `components/objects/record-grouping.ts` (pure, tested) buckets records by the definition version
  they were created under; the record table renders one section per version with that version's
  columns, and keeps records whose version is missing instead of dropping them.
  `field-draft.ts` holds both directions of the editor conversion (`definitionsToDrafts` ↔
  `fieldDraftsToDefinitions`), and their round trip is pinned by a test.
- An edit publishes a version rather than mutating the schema: `UpdateObjectForm` +
  `updateBusinessObjectAction` → `PUT /business-objects/{key}`. Page copy must keep saying that old
  records keep their schema (ADR 0006); do not "fix" a rendering mismatch by rewriting records.

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
  `next.config.ts` sets `transpilePackages: ['@opvaryn/contracts']` and `output: 'standalone'`
  (the deployment image runs the standalone server; `pnpm dev`/`pnpm start` are unaffected).
  `apps/web/public/` is committed empty (`.gitkeep`) because the image copies it — put static
  files there rather than deleting it.
- `apps/web/next-env.d.ts` is generated by Next and flips between the dev variant
  (`.next/dev/types/...`) and the build variant (`.next/types/...`) depending on the last command
  run, so `next dev` leaves it dirty. Revert it before committing; never hand-edit it.
- Tests in `apps/web/__tests__/`: `shell.test.tsx` (badge labels, nav integrity and numbering),
  `task-timeline.test.ts` (event labels incl. unknown types, condition detail, per-role task
  selection), `record-values.test.ts` (FormData → API values), `field-draft.test.ts` (editor
  serialization and round trip), `dashboard-layout.test.ts` (lenient read vs strict write
  validation, every transition), `record-grouping.test.ts` (per-version grouping, orphan buckets).
  Vitest aliases `@` → app root and sets `environment: 'jsdom'`; coverage has no thresholds yet.
- There is no browser backend in this environment, so interactive flows are verified by
  `make smoke-demo-flows` (`scripts/smoke-demo-flows.sh`): it builds and starts both servers,
  renders a page, replays the form's progressive-enhancement POST and checks the result through
  the API and the re-rendered page. Four gotchas that script encodes: the page has more than one
  server-action form (the theme toggle is one), so forms are selected by a marker input; a hidden
  input rendered by the server (e.g. `fields`, `layout`) must be excluded from the replay, because
  `formData.get` returns the first value; server-action forms are posted as
  `multipart/form-data`, so a manual replay must use `curl --form-string` (not
  `--data-urlencode`, which silently skips the action); and React splits interpolated text into
  separate nodes (`attempt {n}` renders as `attempt <!-- -->2`), so page assertions need literals
  or template-literal children. `sign_in_through_form <jar> <email> <password> <label>` and
  `web_get_as`/`web_post_as` let a flow act as two people in turn (flow G does: approver →
  director → return → attempt 2).
