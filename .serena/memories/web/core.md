# apps/web — Next.js admin shell

## Routes and shell

- Routes: `/` is the **public front page** and `/login` the sign-in screen; both stand outside the
  workspace frame (ADR 0014). Every screen behind the sign-in lives in the `app/(workspace)` route
  group — `/overview` (workspace home), `/objects` (+ `/objects/[key]`, plus
  `/objects/[key]/records/[recordId]` for one record and `/objects/[key]/records/export` for the
  CSV download), `/attachments/[id]` (file download), `/forms`, `/workflows`
  (+ `[key]`), `/tasks` (+ `[instanceId]`), `/analytics`, `/apps`, `/admin` (+ `/admin/users`,
  `/admin/users/[id]`, `/admin/departments`, `/admin/roles`), `/roadmap`, `/settings` — and the
  group's `layout.tsx` carries the shell. `proxy.ts` (Next 16's name for middleware; `middleware.ts`
  is deprecated) sends a caller without the session cookie to `/login?next=<path>`; the API still
  validates the token on every call, so a stale cookie reaches the screen and the screen says it
  could not read (ADR 0008). Components import server actions by their real path, e.g.
  `@/app/(workspace)/objects/actions`.
- `app/nav.ts` (`NAV_ITEMS`, `navItemFor`) holds the **workspace** nav only: no `/` and no `/login`;
  `index` values stay sequential and the shell test enforces both. `navItemFor` matches nested routes
  by longest prefix, so `/objects/it_incident` resolves to the Objects area and `/admin/users` to
  Quản trị. `navItemsFor(isAdminUser, showAdvanced)` shows `audience: 'admin'` entries to admins;
  one with `requiresAdvanced: true` (`/settings`, `/roadmap`) also needs the advanced cookie, while
  `/admin` is administration work and does not (ADR 0022). The workspace layout also loads the
  inbox total (`listInboxTasks({limit:1})`) and passes `counts={{'/tasks': n}}` to the sidebar and
  compact nav, which render a small badge on Việc của tôi.
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
- `/objects/[key]` **live**: one data definition in **three tabs** (ADR 0020) — Trường (fields of
  the version in use, version history, `UpdateObjectForm` which publishes the next version from a
  schema editor prefilled with the current fields), Bản ghi (records grouped by definition version
  + the generated entry form), Quy trình (`StartInstanceForm` + `InstanceList`). The open tab is
  `?tab=` in the URL and `components/objects/object-tabs.ts` (pure, tested) resolves it, falling
  back to `fields` for anything unknown; `components/ui/tabs.tsx` is the shared tab bar and each
  tab loads only what it shows (the counts on the bar come from two `limit: 1` reads). Each record
  row carries **Xem các lần chạy →** (`RecordList`'s `runsHref`, the column sits right after `#`
  because a wide schema scrolls sideways) to `?tab=processes&record=<id>`, where the run list is
  filtered by that record, names it when it is among the loaded records, and offers "Bỏ lọc, xem
  tất cả"; the run form preselects it. `params` is a Promise; a missing key calls `notFound()`
  (custom `not-found.tsx` in that segment).
- `/objects/[key]/records/[recordId]` **live** (ADR 0023): one record's own screen — its values
  rendered from its version, who entered it, its department, the version, created/updated stamps,
  the way to its runs, and an edit form + delete (confirmation, then the action redirects to
  `?tab=records&deleted=1` and the list shows "Đã xoá bản ghi"). The API's `canEdit` decides
  whether the controls render at all; a reader without the write rule sees the values read-only
  with the reason (ADR 0021). The records table links every row with **Mở bản ghi**
  (`RecordList`'s `detailHref`) and the tab offers **Xuất CSV** while the visible list is at most
  `MAX_EXPORT_ROWS` (10,000; `lib/export.ts` mirrors the Go constant) — the download goes through
  the route handler, never straight to the API. A `file` field renders `components/forms/file-field.tsx`:
  the file uploads on selection through `uploadAttachmentAction`, the form carries the returned id
  in a hidden input, "Bỏ tệp" clears it (and deletes the unbound upload), and the record page shows
  a `/attachments/{id}` download link named by `attachmentNames` (ADR 0025). The records tab also
  carries **Nhập từ CSV** (`ImportRecordsForm` → `importObjectRecordsAction`; "Kiểm tra trước" sets
  `dryRun=true`, errors are listed by spreadsheet line, import is all-or-nothing — ADR 0026). The
  record screen ends with **Lịch sử thay đổi** (`listObjectRecordHistory`, 10 per page via
  `?hoffset`, action label + actor + "Trường: cũ → mới" — ADR 0027).
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
- `/workflows` **live**: lists definitions from the API and links to the create screen. A new process
  is **drawn on the canvas** (ADR 0019): `/workflows/new` asks three questions (name, the data it
  reads, who receives the first step) and opens on the template graph from
  `components/workflows/new-definition-template.ts` (`templateDraft`, `firstTaskKey` — the step the
  form's role question is bound to). `CreateWorkflowEditor` publishes **v1 of exactly what was drawn**
  through `createProcessDefinitionAction`, which derives the key from the name when the disclosure was
  never opened and `redirect`s to `/workflows/<key>`. The row-based editor is deleted
  (`definition-editor.tsx` and the row model in `definition-draft.ts` are gone; that module now only
  holds `CONDITION_OPS` and `parseGraph`).
- `components/workflows/graph-canvas.tsx` is the shared canvas + inspector, controlled by its parent
  (`draft`, `onDraftChange` as an updater so a fast drag cannot lose a move, `knownRoles`,
  `conditionFields` from the bound object, `canvasLabel`, `readiness`). `WorkflowEditor` (publish mode)
  and `CreateWorkflowEditor` (create mode) both wrap it; the readiness panel's wording is the parent's,
  because "nothing to compare against yet" is a create-mode fact.
- `components/workflows/definition-preflight.ts` (pure, tested) is the **pre-publish checklist in
  Vietnamese**: one start, at least one end and one human task, a role on every human task (and a role
  that is a key), a field on every condition, the ways onward per step kind, both branches on a
  condition, nothing after the end. Each rule is a *necessary* condition of a graph the service
  accepts, so a clean checklist never blocks a valid definition; publish is disabled while something is
  listed, and the Go service keeps the last word for cycles, unreachable steps and condition literal
  types. Do not grow this into a second validator.
- `/workflows/[key]` draws the published graph with `ProcessCanvas`, shows the version history
  (`?version=n` inspects an older version), the runs of that definition, and publishes the next version
  through the canvas. The fixture (`demo-definitions.ts`, `workflow-canvas.tsx`) is gone. Pure, tested
  modules: `components/workflows/definition-layout.ts` (column layout by distance from start,
  `conditionSummary`, `nodeSubtitle`, `outgoingEdges`, `clipTitle` — SVG text does not wrap, so a long
  step title is clipped rather than left spilling over the node box). Publishing stays the only write to
  a definition: an older version is rendered read-only with `ProcessCanvas`, and every edit happens on
  the browser-local draft described above (ADR 0013).
- `/objects/[key]` also carries `StartInstanceForm` (only definitions bound to that object are
  offered — conditions read its fields) and `InstanceList` for its records, backed by
  `listProcessInstances({objectKey})`; `/workflows/[key]` reuses `InstanceList` with
  `{definitionKey}` and passes `recordLabels` (built per object from `listObjectRecords` +
  `listBusinessObjectVersions`) so a row names the record it runs on — the label uses each record's
  own definition version (`components/objects/record-labels.ts`, `fieldsForVersionNumber`).
  `components/process/instance-list.tsx` is the shared row view (record, state, definition version ·
  lần chạy, the waiting step, who holds it up). Both callers pass `roleLabels` — a role with no label
  reads as its key, so a missing catalogue read must not take the screen down (the objects page wraps
  `listRoles()` in `.catch(() => [])` for exactly that reason).
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
- `/admin` **live** (ADR 0022, ADR 0029, ADR 0031, ADR 0035): the areas are Tổng quan ·
  Người dùng · Phòng ban · Vai trò · **Giờ làm việc** (the calendar that decides what a
  deadline means) · **Chính sách việc** (the deadline, priority and escalation role of each
  kind of work).
  The workflow inspector carries two fields on a human step: the deadline in working hours
  and the role that takes the step over; the inbox shows the deadline and marks a task late.
- `/admin` **live** (ADR 0022, ADR 0029): an account that is waiting out a sign-in cooldown
  carries `lockedUntil`; the accounts list shows it, the account page offers **Mở khoá đăng nhập**
  only while the account waits, and the action redirects to `?unlocked=1` so the confirmation
  survives the re-render (the card that carried the button is gone once the wait ends).
  `components/admin/cooldown.ts` is the pure rule (a moment that already passed means free);
  `lib/format.ts` owns the clock format (`formatClock`). the organisation administration area, four screens sharing
  `components/admin/admin-nav.tsx` (Tổng quan / Người dùng / Phòng ban / Vai trò). `lib/admin-server.ts`
  (`loadAdminAccess`) asks `/me` once per page: a non-admin gets `notFound()`, an API failure renders
  `AdminLoadError` (an error is not a 404). Tổng quan counts the three catalogues (`limit: 1` reads)
  and states the fixed permission model — it manages who holds which role, never an arbitrary
  permission matrix. Người dùng is paged + `q`, a `<details>` create form (`components/admin/user-form.tsx`,
  create and edit modes; the signed-in account cannot disable itself) and a detail page with
  `PasswordResetForm` + `RevokeSessionsForm` (`security-forms.tsx`); Phòng ban and Vai trò are paged
  catalogues with inline rename forms and `DeleteForm` (`delete-form.tsx`: `window.confirm`, and a
  control that cannot work is rendered disabled with the reason — a department with people, a
  system role). Server actions live in `app/(workspace)/admin/actions.ts`; they only assemble the
  request and map the error envelope, so the API stays the authority (403 for a replayed form).
  Forms may be replayed without JavaScript — `smoke-demo-flows` creates an account through the real
  form and checks it through the API.
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
  `@opvaryn/contracts` (generated; regenerate via `make contract-generate`). Every call carries
  `AbortSignal.timeout(API_TIMEOUT_MS = 15s)` (the contracts client and `lib/api/auth.ts`), so an
  API that accepts the connection and stops answering fails like one that is down instead of
  holding a page or a server action open.
- `fetchApiWithSession(path, init)`: the same client for the few endpoints that are not JSON
  (the CSV export and attachment downloads). Route handlers under `app/(workspace)/…/route.ts`
  stream the upstream body back with its headers, and the browser never talks to the API.
- `app/(workspace)/error.tsx` is the workspace error boundary (one sentence, "Thử lại", optional
  digest). There is deliberately **no workspace-level `loading.tsx`**: a streaming loading
  boundary flushes the response before a page calls `notFound()`, so unknown objects/admin screens
  would answer 200 instead of 404 — smoke-demo-flows checks the 404 status (ADR 0015).
- Sign-in is a BFF: the form (`app/login/page.tsx` + `components/auth/login-form.tsx`) posts
  `loginAction`, which calls the API and stores the returned token in the web app's own httpOnly
  cookie (`lib/session.ts`, `SESSION_COOKIE = 'opvaryn.session'`). `createServerApiClient` forwards
  that token as a Cookie header, so the browser never holds it and no component fetches the API
  directly. `components/auth/session-summary.tsx` is the topbar **account menu**: a native
  `<details>` showing name/email/department/roles with a nested **Đổi mật khẩu** disclosure
  (`PasswordForm` → `app/actions/password.ts`, which maps the service's validation sentences to
  Vietnamese) and the **Đăng xuất** form — the only sign-out in the workspace. It fails soft when
  the API is down, and its sign-out button carries `name="logout"` so smoke-demo-flows replays it.
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
- `lib/format.ts`: `FIELD_TYPE_LABELS`, `formatTimestamp`, `formatClock` (the one time format),
  `primaryFieldValue` (the naming rule, aligned with the API's: a file or a list of rows is not
  a name, so a record without a readable name says so),
  `formatDate` (no timezone shift),
  `formatFieldValue` (per field type), `primaryFieldValue` (the label that identifies a record).

## Schema-driven UI

- The form's field kinds (ADR 0032): `formula` is a read-only line in the form (the server
  computes it), `visibleWhen` hides a field the form does not need (the same rule as the
  server's, in `lib/conditions.ts`), and `table` is an editable table of typed cells
  (`components/forms/table-field.tsx`). The schema editor writes them in
  `components/objects/field-draft.ts`.
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
- **Pagination rule** (ADR 0017): list endpoints take `limit`/`offset` (+ `q`) and answer
  `{data, total}`; the API slices, never the browser. The instance list also takes `recordId`
  alongside `objectKey`/`definitionKey` (ADR 0020), and the filters compose — that is what answers
  "bản ghi này đã chạy quy trình nào" without a client-side filter over a sample. `components/ui/list-controls.tsx` holds
  `ListSearch` (a GET form, so the term lives in the URL), `Pagination` (`offsetParam` when a
  screen paginates two lists, e.g. records `offset` vs instances `ioffset`) and `pageOffset`.
  Screens that need a sample ask for one (`{limit: RECENT_LIMIT}` in the dashboard, `RECORDS_PER_APP`
  in the showcase) — no `.slice()` after a full fetch anywhere. The client returns `Paged<T>`, so
  call sites read `.data`. Limits: default 25, max 100, refused by name when out of range.
- **Only what the user needs** (ADR 0018): a screen shows what the person needs to decide or act —
  no field/node keys, no record ids, no table names, no internal vocabulary (`node` → "bước",
  `attempt 2` → "lần 2", `sum(amount)` → "Tổng của Giá trị dự kiến", `gte` → "từ"), and an
  unreadable record says "Bản ghi bạn không đọc được" instead of an id. `lib/names.ts` decides how
  a key becomes a name; `process-timeline.ts` takes `EventLabels` (roles + fields) so the audit log
  reads in names. The one place a key is shown is the designer's input where a key is being chosen.
- **Names, never keys** (ADR 0016): a department, a role, a definition and a record are shown by
  their human name. `lib/names.ts` holds the pure, tested rule — `labelOrKey(label, key)` returns
  the name when there is one and the key otherwise (never an invented name); `roleLabels(entries)`,
  `nameLabels(items)`, `joinLabels(keys, map)` and `optionValueNames(object)` (select value →
  option label, for metric breakdowns) build the lookups. Sources: `me.departmentName`
  and `me.roleLabels` (a map, only for the roles the person holds), `GET /api/v1/roles` which now
  returns `[{key, label}]` (RoleEntry), `listProcessDefinitions()` for definition names, and
  `recordLabels()` from each record's own version. Keys are acceptable only on the operator screen
  (Vận hành) and inside inputs where a designer is choosing a key (the role datalist shows the
  label as option text, the value stays the key). Role labels are data: the `roles` catalogue
  (migration 0010; `role_labels` folded into it), renamed at `/admin/roles` or with
  `useradm -set-role-label`, seeded by `scripts/seed-demo.sh`.
- **Permission rule** (ADR 0021): the interface never renders a control the person has no
  permission for. `canDesign(roles)` (`lib/access.ts`: `process_designer` or `admin`, the same rule
  as the service's `requireDesigner`) decides the definition/process/metric controls, and the empty
  place is `components/ui/role-notice.tsx` (`DesignerNotice`, with the role named by
  `designerRoleName(catalogue)` from `role_labels`, prose when nobody named it). Gated today:
  `/objects` (create form), `/objects/<key>` (schema editor), `/workflows` (create button),
  `/workflows/<key>` (the canvas renders read-only `ProcessCanvas` for a non-designer instead of
  `WorkflowEditor`), `/analytics` (metric form). Screens are still *not* hidden by role — everyone
  reads definitions, processes, records and metrics; only the admin's build/ops screens differ.
- **Audience rule** (ADR 0015, extended by ADR 0022): the workspace is built for the person using
  it. Everyone signed in sees the product screens (nav labels are Vietnamese: Dữ liệu, Nhập liệu,
  Quy trình, Việc của tôi, Báo cáo, Ứng dụng); `/admin` (Quản trị) is `audience: 'admin'` and
  appears for any administrator; `/settings` (Vận hành) and `/roadmap` (Lộ trình) also need
  **advanced mode on** (`requiresAdvanced`). Every admin screen calls `notFound()` for anyone else
  — a 404, not a 403. The switch is the cookie `opvaryn.advanced` behind
  `app/actions/advanced.ts`, read through `lib/advanced-server.ts`, decided by the pure
  `lib/advanced.ts` (+ `lib/access.ts` for `isAdmin`).
  The cookie grants nothing — the API still authorizes every call. `/overview` is a dashboard of the
  person's own work (greeting, "Việc đang chờ bạn", shortcuts, "Lần chạy gần đây"); the build status,
  screen list, "chưa có trong V1" and the label legend live in an `AdvancedSection` below it. Only
  simulated or planned parts carry a badge now — `Live` badges were removed everywhere.
- **Copy rule** (AGENTS.md, ADR 0014): product screens speak to the person doing the work. No ADR
  numbers, decision codes, repo paths, `make` commands or database/HTTP words ("PostgreSQL", "cookie
  httpOnly", "event log", "engine") — those live in code comments, docs and `/settings`, the one
  screen written for whoever operates the system (it keeps endpoints, ports and the seed/smoke
  commands). A screen that cannot load data says so in one sentence and points at the administrator;
  it does not print shell commands. The workspace home carries no team charter or decision register
  either — those are docs.
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
- A real Chromium is available for interactive verification through the Playwright install at
  `/home/niand/Workspace/nian-id/node_modules/playwright` (`node -e "require(...)"`); the demo video
  scripts in `~/Videos/opvaryn-demo-*/quay-demo.cjs` are built on it. Verify UI interaction against
  the **production build** (`pnpm build && pnpm start`): with `next dev` (Turbopack) in this
  environment the workflow page's client components rendered but did not hydrate — clicks on the
  canvas changed nothing while the same page under `pnpm start` worked.
- Without a running web server, interactive flows are also verified by
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
