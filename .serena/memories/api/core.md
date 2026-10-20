# apps/api — Go service (module `github.com/QuocDuong16/opvaryn/api`)

Entry points: `cmd/server` (HTTP server, signal-aware graceful shutdown) and `cmd/migrate`
(migration runner). Both read config through `internal/config`.

## HTTP surface (`internal/httpapi`)

- `NewRouter(cfg, store, httpapi.Services{BusinessObjects, ObjectRecords, ProcessDefinitions,
  ProcessRuntime, Identity}, logger)` wires middleware: chi RequestID, custom `requestLogger`
  (structured, request-id correlated), `sessionMiddleware`, Recoverer, CORS from
  `CORS_ALLOWED_ORIGINS`. `middleware.RealIP` is intentionally NOT used (spoofing advisories) —
  do not add it back without a trusted-proxy design. Every route except `/healthz`, `/readyz`,
  `/api/v1/meta` and `/api/v1/auth/*` calls `requireUser`; the contract declares the
  `sessionCookie` security scheme (apiKey in cookie `opvaryn.session`).
- `respond.go` owns the error envelope, the `code*` constants, and `decodeJSON` (1 MiB cap,
  DisallowUnknownFields, rejects trailing content). Unknown routes/methods also return the JSON
  envelope.
- Implemented: `GET /healthz`, `GET /readyz` (2s DB ping timeout → 503 `unavailable`),
  `GET /api/v1/meta` (from `internal/buildinfo`), `GET/POST /api/v1/business-objects`,
  `GET/PUT /api/v1/business-objects/{key}` (PUT publishes the next immutable version),
  `GET /api/v1/business-objects/{key}/versions` (newest first),
  `GET/POST /api/v1/business-objects/{key}/records` (each record reports `objectVersion`,
  `canEdit`, `createdByName`, `departmentName`) and
  `GET/PUT/DELETE /api/v1/business-objects/{key}/records/{recordId}` (ADR 0023; visibility is
  the list scope, a hidden record answers 404; delete refuses `in_use` when an instance exists),
  `GET .../records/export` (ADR 0024, `text/csv` with BOM, union of version fields, 10k cap),
  `POST .../records/import` (ADR 0026, multipart CSV, dry run, 500 rows, all-or-nothing),
  `GET .../records/{recordId}/history` (ADR 0027, paged append-only audit) and the attachment
  surface: `POST /api/v1/attachments?objectKey=` (multipart `file`, 201),
  `GET/DELETE /api/v1/attachments/{attachmentId}` (download is always
  `application/octet-stream` + `Content-Disposition: attachment`; ADR 0025).
- Process runtime (ADR 0007): `GET/POST /api/v1/process-definitions`,
  `GET/PUT /api/v1/process-definitions/{key}`, `GET .../versions`,
  `POST /api/v1/process-instances` (start from a stored record),
  `GET /api/v1/process-instances/{id}` (instance + tasks + event log) and
  `POST /api/v1/process-instances/{id}/tasks/{taskId}/decisions`.
- Identity (ADR 0008): `POST /api/v1/auth/login` (sets the httpOnly `opvaryn.session` cookie),
  `POST /api/v1/auth/logout` (204), `POST /api/v1/me/password` (204; verifies the current
  password, keeps the calling session and ends the others), `GET /api/v1/me` and `GET /api/v1/roles` (the role catalogue:
  `SELECT DISTINCT role FROM user_roles`, sorted — what the designer offers, so a definition cannot
  silently name a role nobody holds). `sessionMiddleware` resolves the cookie
  once per request into the request context; `requireUser` answers 401. The runtime endpoints
  (start instance, decide task, read instance) require a session, and the decision's actor and
  roles come from the authenticated user — `actorRole`/`actor` are gone from the request bodies.
- Administration (`/api/v1/admin/*`, ADR 0022, handler file `admin.go`): users
  (`GET/POST /admin/users` paged + `q`; `GET/PUT /admin/users/{userId}`;
  `POST .../password` → 204 and revokes sessions; `DELETE .../sessions` → 204), departments
  (`GET/POST /admin/departments`, `PUT/DELETE /admin/departments/{key}`) and the role catalogue
  (`GET/POST /admin/roles`, `PUT/DELETE /admin/roles/{key}`). Every handler is `requireUser` then
  `requireAdmin` in the service (403 otherwise); deletes answer 204, a row something still depends
  on answers 409 `in_use`. `POST /admin/users/{userId}/unlock` → 204 clears the sign-in
  cooldown (ADR 0029 — the endpoint ADR 0028 point 5 originally refused; the admin area it
  asked for exists since ADR 0022). `AdminUser` is the admin view of an account and carries
  `lockedUntil`: `Admin.lockedUntilFor` reads the five newest failures per address through
  `store.RecentLoginFailures` and returns `failures[4] + loginFailureWindow`, the exact moment
  the login path stops blocking. The window and the limit are service constants
  (`loginFailureWindow`, `loginFailureLimit`); the store only answers with timestamps.
- Inbox (ADR 0008): `GET /api/v1/tasks` returns the open tasks of the roles the session holds,
  oldest first, each with its instance (`ListOpenTasksForRoles`). It is what the web `/tasks`
  screen reads.
- `GET /api/v1/process-instances?objectKey=&definitionKey=&recordId=` lists the instances the caller
  may see, newest first, capped at `maxInstanceList` (200) in the service, each row with its
  still-open tasks (`ListVisibleProcessInstances`, two queries: the instances, then the open tasks of
  those ids). The key filters are trimmed and must match `KeyPattern`; `recordId` is an id, so it is
  parsed and a malformed one is refused by name (400). All three compose, and visibility is the
  record's, so a hidden or unknown record yields an empty list rather than a 403 — the filter never
  confirms that a record exists. `recordId` is what the object detail screen asks with when someone
  opens one record's runs (ADR 0020).
- Error mapping lives in `writeStoreError`: `ValidationError` → 400, `store.ErrNotFound` /
  `service.ErrUserNotFound` → 404, `store.ErrInUse` → 409 `in_use` (the store sentence names what
  depends on the row, stripped of the package prefix by `trimStorePrefix`),
  `store.ErrConflict`/`ErrTaskClosed`/`service.ErrStateConflict` → 409, `service.ErrForbidden` → 403
  (the user does not hold the role, D08b), `service.ErrUnauthorized` → 401 `unauthorized`,
  `store.ErrUnavailable` → 503. `parseUUIDParam` turns a malformed path id into a 400 instead of a
  zero UUID.
- `system.go` = health/readiness/meta handlers; `businessobject.go` = list/create/get handlers
  plus the domain ↔ `apiv1` mapping helpers (`toAPIBusinessObject` including optional select
  `options`, `toDomainFields`, `pointerOrNil`/`stringValue` for optional fields);
  `objectrecord.go` = record handlers + `toAPIObjectRecord(s)`.
- `writeStoreError` lives in `httpapi/respond.go` next to the error envelope (it is the single
  error mapper for every handler): service
  `ValidationError` → 400 `invalid_request`, `store.ErrNotFound` → 404 `not_found`,
  `store.ErrConflict` → 409 `conflict`, `store.ErrUnavailable` → 503, else 500.

## Service (`internal/service`)

- `BusinessObjects` wraps the narrow `businessObjectStore` interface (fakeable in tests).
- `Create` validates (`validateNewBusinessObject`: key shape + `validateDefinition`) then
  normalizes (trim) before persisting; `Update` reuses `validateDefinition`, so a definition edit
  and a definition create enforce exactly the same rules. `ListVersions` resolves the object first
  (404 for an unknown key) and reads its snapshots.
- Limits: 100 fields, name ≤120, description ≤500, label ≤120, 50 select options ≤120 chars.
- `FieldDefinition.Options` rules (only the `select` type carries options): select must declare
  at least one option, values must be non-empty/unique after trimming, options on other types are
  rejected.
- `ProcessDefinitions` validates the graph (`validateProcessGraph`: exactly one start, ≥1 end and
  ≥1 human task, DAG with cycle and reachability checks, condition nodes with one `true` and one
  `false` branch, roles on human tasks) and validates each condition against the bound business
  object's field definitions (`validateProcessCondition`: field must exist, operator must suit the
  type, ordering ops only for number/date, select literals must be declared options). Create
  publishes v1; Update publishes the next version.
- `ProcessRuntime` is the engine: `Start` binds an instance to the definition version current at
  that moment and walks to the first waiting human task (or straight to an end node). `Decide`
  checks the actor role against the task's role (D08b), requires a reason for return/reject, and
  builds one `domain.CompleteTaskWrite` that the store applies atomically. Approve advances, return
  resets to a new attempt (cancelling the other open tasks), reject is terminal. Conditions are
  evaluated inside the same call against the record's current values and what they saw is written
  into the event log. `EvaluateCondition` treats a missing/null value as false for every operator.
- `processGraph` indexes a published version (nodes, unconditional successors, condition branches);
  a broken stored graph is an internal error because publishing validates it.
- `Identity` (ADR 0008) owns the only password hashes: arangon2id PHC strings
  (`HashPassword`/`VerifyPassword`, parameters travel with the hash), sessions whose token is
  returned once and stored only as SHA-256, and user administration. `LocalProvider` implements the
  `Provider` seam an OIDC provider will fill later; an unknown email still runs a dummy hash so
  response time does not reveal whether an address exists, and both failures return
  `ErrInvalidCredentials`. `CreateUser` validates email shape, department existence and role keys;
  `SetPassword`/`ListUsers` never expose hashes, and a password change revokes that user's
  sessions. `Login` counts failures per address: 5 in 15 minutes trigger a 15-minute cooldown
  (`loginFailureLimit`/`loginFailureWindow`) that answers exactly like a wrong password (dummy
  hash included); success clears the count, and `UnlockEmail` / `PruneLoginFailures` back
  `useradm -unlock` / `-prune-login-failures` (ADR 0028). The failure rows are stamped with the
  **service** clock (`RecordLoginFailure(ctx, email, at)`), and the window predicates use `>` so
  the row that leaves the window is exactly the moment the account is free. A **disabled** account
  is not counted: the provider returns an internal `errAccountDisabled`, the login path answers the
  generic one and leaves the counter alone. `CountRecentLoginFailures` and
  `store.RecentLoginFailures` stop at the limit instead of counting a hammered address, and the
  latter reads at most 5 rows per address through a `LATERAL` join on
  `login_failures_email_idx`. `ChangePassword(token, current, next)` verifies the current password, refuses an
  unchanged one and calls `UpdatePasswordKeepingSession` (the calling session survives, the rest
  end). `AuthenticateAndRenew` slides a session forward when less than half the 12h TTL remains
  (store `TouchSession`), and the HTTP middleware refreshes the cookie to match, so an active
  person is not signed out mid-day while an idle session still ends.
  The first administrator comes from `cmd/useradm`
  (`make useradm ARGS="-create ..."`), because the first user cannot be created through the API;
  later accounts go through the `Admin` service (ADR 0022).
  `useradm` also has `-add-role` (additive), `-unlock -email` (lifts one address early),
  `-list-lockouts` (the addresses waiting out a cooldown, ADR 0029) and `-prune-sessions` (deletes sessions whose expiry
  passed; housekeeping only, since lookups already filter on `expires_at`, and the API deliberately
  has no scheduler).
- `Admin` (`internal/service/admin.go`, ADR 0022) is the organisation administration service and
  starts every method with `requireAdmin`: user list/get/create/update (roles are replaced, not
  added), `SetPassword` (revokes sessions), `RevokeSessions`, department CRUD, role CRUD and
  `RoleLabels`. It has its own narrow `adminStore` interface, separate from `Identity`'s, and
  reuses the package-level `HashPassword`/`validatePassword`/`maxNameLength` and its own
  `validateProfile`/`validateRoles`/`validateDepartment`/`validateRole`. The service refuses
  disabling the signed-in account; the store keeps the last active administrator (advisory lock
  `opvaryn_admin_guard` inside `UpdateUser`).
- Authorisation lives in `internal/service/authz.go` (`requireAuthenticated`, `requireDesigner`,
  `requireAdmin`) and in each service, never in the UI (playbook invariant 4). Matrix: reading definitions is open
  to any signed-in user (forms are generated from them); creating/publishing a definition needs
  `admin` or `process_designer`; creating a record is open, and the record is stamped with the
  caller's user id and department **from the session, never from the payload**. `domain.Principal`
  carries user/department/roles; `domain.RecordScopeFor(principal)` builds the read scope. A
  deliberate non-rule: admin cannot decide a task assigned to another role (approval belongs to
  that role). An instance is visible exactly when its record is; hidden means 404, never 403.
- `Metrics` (D06, ADR 0010) owns metric definitions and answers them: one object, one aggregation
  (count/sum/avg), at most one filter (the D04 condition shape, through the *same* validator as
  process branches) and at most one grouping. Field kinds are resolved on save and stored, so a
  later schema edit does not change what a metric measures. `Result` runs the metric with
  `RecordScopeFor(principal)`, so two people can legitimately see different numbers. Create/update
  need a designer; list/get/result need a session.
- `ObjectRecords` also has `Get`/`Update`/`Delete` (ADR 0023): a record hidden by the scope is
  `ErrNotFound`; writing needs `CanWriteRecord` (admin, creator, or the record's department — a
  cross-department task holder cannot rewrite the request); the update validates against
  `FindBusinessObjectVersion(record.ObjectVersionID)` and rewrites the projection; delete maps
  the store's `ErrInUse` when a process instance refers to the record. `ProcessRuntime.Start`
  now reads through `FindVisibleObjectRecord`, so a record outside the caller's scope looks
  missing instead of being startable by UUID.
- `ObjectRecords` wraps `recordStore` (look up definition → validate values → insert). Validation
  (`validateRecordValues` → `validateFieldValue`) rejects unknown keys, missing required fields,
  wrong types per field type (text/file string ≤4000, number, date `YYYY-MM-DD`, select must be a
  declared option, rows a list of strings), sorts unknown keys so messages are deterministic, and
  `normalizeRecordValues` trims text and drops blank optional values. The store's `ErrNotFound`
  stays wrapped in the returned error so the handler maps it to 404.
- `KeyPattern` is the platform-wide machine-key shape: `^[a-z][a-z0-9_]{1,63}$`.

## Store (`internal/store`)

- `Store` wraps `*pgxpool.Pool`; `New` connects lazily so the API starts while the DB is down
  (`Ping`/`readyz` report reality).
- `businessobject.go`: the schema lives in `business_object_versions` (single source of truth);
  `business_objects` stores identity + metadata only and `businessObjectSelect` joins the newest
  version with `JOIN LATERAL (...) ORDER BY version DESC LIMIT 1`. `CreateBusinessObject` inserts
  the object and publishes v1 in one `pgx.BeginFunc` transaction; `UpdateBusinessObject` locks the
  row (`SELECT ... FOR UPDATE`), computes `MAX(version) + 1`, inserts the snapshot and updates the
  row — so two concurrent publishes cannot pick the same version number. Published rows are never
  updated. `GetBusinessObjectByKey` maps `pgx.ErrNoRows` → `ErrNotFound`.
- `objectrecord.go`: `ListObjectRecords` joins `business_object_versions` to return the record's
  `ObjectVersion` (ordered `created_at DESC, id`); `CreateObjectRecord` stores `object_version_id`
  and the service fills the version number it already knows. A foreign-key violation (23503)
  becomes `ErrNotFound` because the addressed definition or version was deleted concurrently.
- `errors.go`: `classify()` maps `*pgconn.PgError` connectivity (`*pgconn.ConnectError`) to
  `ErrUnavailable`; unique-violation 23505 → `ErrConflict` in the repo method.
- `migrate.go`: `ApplyMigrations` creates `schema_migrations(version, checksum, applied_at)`,
  takes `pg_advisory_lock(hashtext('opvaryn_schema_migrations'))`, applies each
  `sql/migrations/*.sql` in lexical order in one transaction per file, records sha256, and
  refuses when an applied migration's checksum changed. Files are read through `os.DirFS`
  (avoids gosec G304). Run from `apps/api` because of the default `-dir`.
- `store/admin.go` (ADR 0022): paged `ListUsersPage`/`ListDepartmentsPage`/`ListRolesPage`
  (search over name/key, holder/user counts), `UpdateUser` (one transaction: profile + role set
  replaced, sessions deleted when disabled, `pg_advisory_xact_lock(hashtext('opvaryn_admin_guard'))`
  then a check that at least one active admin remains → `ErrInUse`), `CreateDepartment`/
  `UpdateDepartmentName`/`DeleteDepartment` (refuses a department with users or records),
  `CreateRole`/`UpdateRoleLabel`/`FindRole`/`DeleteRole` (refuses a system role, a held role, or a
  role named by any `process_definition_versions.nodes[].assigneeRole`). `store/identity.go` now
  registers role keys into `roles` when granting them, and `UpdatePassword` revokes sessions in the
  same transaction. `store/rolelabel.go` reads/writes the `roles` table.
- `store/attachment.go` + `service/attachment.go` (ADR 0025): uploads are rows in `attachments`
  (bytea, 10 MB cap, CHECKs), bound inside the record write with `bindAttachmentsTx` /
  `replaceAttachmentsTx`; `FindVisibleAttachment` gives unbound files to their uploader (or admins)
  and bound files to the record scope; `PruneOrphanAttachments` backs
  `useradm -prune-orphan-attachments` (24h). `sanitizeFileName` keeps one path component and the
  content type is sniffed with `http.DetectContentType`, never taken from the request.
- `recordimport.go` (ADR 0026): `ObjectRecords.Import` reads a CSV whose header matches field
  keys or labels, converts by type (`parseImportNumber` accepts `1.500.000`/`12,5`,
  `parseImportDate` accepts ISO and `DD/MM/YYYY`, select by label or value, rows split on `;`),
  reports `ImportRowError{Row (spreadsheet line), Message}`, writes nothing if any row fails,
  `dryRun` stops before the store, and file fields are refused. `CreateObjectRecords` inserts the
  batch plus one `created` audit row each in one transaction.
- `recordaudit.go` (ADR 0027): `History` (scope-checked, paged) renders field labels and values;
  `recordChanges` compares canonical JSON; the store's `insertRecordAuditTx` runs in the record's
  transaction and `ListRecordAudit` reads newest first. History has no FK to the record.
- `recordcsv.go` (ADR 0024): pure `encodeRecordsCSV(versions, records)` — BOM, union of version
  fields (newest first), `select` labels, `rows` joined with "; ", file columns as the file name,
  and `sanitizeCSVCell` prefixing `= + - @` with an apostrophe. `MaxExportRows = 10_000`, refused
  by name in `ObjectRecords.Export`.
- Migrations: `0001_business_objects.sql` (definitions), `0002_business_object_records.sql`
  (`object_id` FK with ON DELETE CASCADE, `values` JSONB object, index on `(object_id,
  created_at DESC)`), `0003_definition_versions.sql` (version table, backfills every existing
  definition as v1 keeping `created_at` as `published_at`, binds existing records to their v1,
  then drops `business_objects.fields`), `0004_process_runtime.sql` (`process_definitions`,
  `process_definition_versions`, `process_instances` with a state/finished_at consistency check,
  `process_tasks` with a partial unique index on one open task per node+attempt and a CHECK that
  returned/rejected tasks carry a reason, `process_events`), `0005_identity.sql` (`departments` as a
  closed catalogue, `users` with lower-cased emails and a NOT NULL department, `user_roles`,
  `sessions` storing only the token hash), `0006_record_scope.sql` (adds
  `business_object_records.created_by` + `department_key`, backfills `department_key` from the
  record's own `values.department` when it matches a real department, and indexes
  `(department_key, created_by)`), `0010_role_catalogue.sql` (the `roles` table: key, label,
  `is_system`, `created_at`; backfills every `user_roles.role` and `role_labels` row, seeds
  `admin`/`process_designer` with Vietnamese default labels and `is_system = true`, drops
  `role_labels`, adds `user_roles_role_idx`), `0011_attachments.sql` (the `attachments` table:
  `bytea` content, 10 MB CHECK, `record_id` FK ON DELETE CASCADE, unbound-upload index for pruning),
  `0012_record_audit.sql` (append-only `record_audit`; no FK on `record_id`; actor name snapshot;
  `changes` jsonb) and `0013_login_failures.sql` (`login_failures(email, failed_at)` for the
  cooldown).
- Working hours and deadlines (ADR 0031): the calendar is `working_hours` (weekday, start and
  end minute), edited in the `/admin` area; `service.WorkingCalendar.AddWorkingHours` is the pure
  arithmetic (weekends and nights are skipped) and `service.WorkingHours.Deadline` turns a
  step's `dueInWorkingHours` into a moment. A `human_task` node may carry `dueInWorkingHours`
  and `escalateToRole`; the runtime stamps `due_at` on the task, and the escalation worker
  (`service.Escalation`, also `useradm -escalate`) hands an overdue task over in one
  transaction: the old task is cancelled, the new one created for the other role, and a
  `task_escalated` event appended. `process_tasks.escalated` keeps a step from bouncing
  between roles.
- The form's field kinds (ADR 0032): a `formula` field is computed by the server (the
  expression is parsed into a tree and walked — never evaluated as code; `internal/formula`),
  a field with `visibleWhen` is not shown and not stored when its condition does not hold,
  and a `table` field holds rows of typed cells. `service.prepareValues` applies the three
  rules before the record is validated; the web mirrors the condition rule in
  `lib/conditions.ts`.
- `store/search.go` holds `likeTerm`: a search term is escaped (`%`, `_`, `\`) and every
  ILIKE filter declares `ESCAPE '\'`, so a person searching for "50%" finds that text and not
  everything. A term is escaped in the store method that owns the query.
- The record search reads the typed projection (`record_field_values`), not the raw JSONB: a
  field that is filtered gets a projection (AGENTS.md). The filter is `objectRecordFilter` in
  store/objectrecord.go; it matches values only, never field names.
- `recordVisibleToScope` is now `recordVisibleToScopeAt(base)` (a function), so a query whose
  own parameters are few can use the rule without a gap in the numbering; the webhook delivery
  log uses base 1 and joins the run to the record, so a delivery of a record the caller may not
  read is not listed.
- `store.RecordLabelSources` reads the values and the version fields of a page of records, so a
  list can name each record with the schema that record has (ADR 0006). `service.recordLabel`
  (service/recordlabel.go) applies the rule — the first text field, else the first field — and
  `ProcessRuntime.List`/`Inbox` put the result in `RecordName`; the API returns it as
  `recordName`. The web no longer builds record names from a sample of 100 records.
- The role catalogue (`store.ListHeldRolesPage`) only offers roles an **active** person holds:
  a role only disabled people carry would wait forever on a run.
- Setting a password (admin area or CLI) clears the sign-in counter of that address, and so does
  changing the address — the remedy the administrator just applied ends the wait.
- `Principal.PublisherLabel()` is who published a definition version: the person's name, or their
  address when nobody has named them, and `system` when there is no person. It is written to
  `published_by` (ADR 0006, point 7).
- `store/objectrecord.go` applies `recordVisibleToScope` to every read and write-back lookup: admin
  (`$2`) sees all, otherwise the record's department (`$3`), the caller's own records (`$4`), or a
  record whose instance has an open task for a role the caller holds — that last clause is what
  keeps cross-department approval working. `FindObjectRecord` returns the object key and the scope
  columns the service needs to stamp and check; `FindVisibleObjectRecord` applies the scope in the
  query. `UpdateObjectRecord` rewrites `values` + `record_field_values` in one transaction (object,
  version and creator untouched); `DeleteObjectRecord` answers `ErrInUse` while an instance refers
  to the record. `objectRecordSelect` joins `users`/`departments` only for the display names.
- `ProcessMetrics` (ADR 0011) answers the operational read model over `process_instances`/`process_tasks`
  (counts, cycle time, step time, approval/rework rate) with the same scope fragment; `Webhooks`
  (ADR 0012) queues outbound deliveries, drains them with retry/backoff and exposes the delivery log.
  Both are fixed catalogues: process metrics because each number has one correct definition, webhooks
  because the payload is a contract. Placeholders in the process-metric SQL follow the scope
  convention ($2..$4 = scope, so the query's own parameters sit at $1 and $5) — getting that wrong
  makes PostgreSQL cast a timestamp to boolean.
- `store/metric.go` (D06): metric CRUD plus `MetricValue`, which builds SQL from a `domain.MetricQuery`
  plan — aggregation, operators and columns come from allowlists, every value is a bind parameter, and
  the query joins `business_object_records` to apply `recordVisibleToScope`. The total is always its
  own query (summing bucket averages would be wrong for `avg`); buckets are capped at 50 and ordered
  biggest first. `CreateObjectRecord` now takes the record's `[]domain.RecordFieldValue` and writes
  them in the same transaction, so no record exists without its projection.
- `store/process.go` owns the atomic writes: `StartProcessInstance` (instance + tasks + events in
  one transaction) and `CompleteProcessTask` (task CAS then instance CAS then cancels/creates/events;
  a failed CAS returns `ErrTaskClosed` or `ErrConflict`, and `explainTaskMiss` tells a missing task
  apart from a decided one). `FindBusinessObject`/`FindObjectRecord` answer `found bool` so the
  service can report bad input instead of a missing resource.

## Contract and tests

- `internal/api/v1/types.gen.go` is generated (oapi-codegen, models only — path params are read
  with `chi.URLParam`, no params structs exist). Regenerate via `make contract-generate`; never
  edit.
- Tests: `internal/service/businessobject_test.go` (table-driven validation + normalization,
  including option rules), `internal/service/objectrecord_test.go` (value validation per field
  type, normalization, `ErrNotFound` propagation), `internal/service/processruntime_test.go` (graph
  rejection table + engine transitions) and `internal/service/authz_test.go` / `identity_test.go`
  (anonymous refused, designer-only definitions, scope carried, records stamped from the principal,
  hidden instance → 404, inbox per roles, `-add-role` is additive); fake stores assert invalid
  input never reaches persistence.
- `scripts/smoke-api.sh` (`make smoke-api`) exercises every endpoint against real PostgreSQL,
  including record creation, the unknown-key/option/required/duplicate branches, the 404 envelope,
  publishing a definition version, the version history order, that records keep the version they
  were created under, and the whole identity + runtime path (it bootstraps a department and two
  users with `useradm`, logs in, asserts 401 without a session, 403 for a task the user does not
  hold, 409 on a second decision and that the audit is attributed to the signed-in user), the
  self-service password change (wrong current 400, this session survives, the other one dies) and
  the record path (one record read, hidden 404, edit against its own version, unused delete 204,
  delete with an instance 409), the CSV export (BOM, both versions' columns, scope, search), the
  CSV import (dry run writes nothing, bad rows reported by line with nothing written, real import
  stores rows, Vietnamese formats accepted, unknown header 400), the record history (created +
  updated with labels/values, hidden 404), the login cooldown (5 failures block the right
  password; `useradm -unlock` lifts it), and the attachment path (upload, bind, download headers,
  scope 404, bound delete 409, replace, unbound delete), plus the administration path (403 for a non-admin; department/role/account created through
  `/api/v1/admin/*`; 409 `in_use` for a department with people and a held role, 204 for empty
  ones; a password reset kills the old session and the new password works; revoking sessions signs
  the person out; update replaces the profile and the role set);
  `scripts/seed-demo.sh` (`make seed-demo`) seeds demo data through the API — departments, one
  account per role, three objects (`purchase_request`, `it_incident`, `hr_onboarding`), the three
  pilot definitions (`purchase_approval`, `incident_triage`, `hr_onboarding_flow`) and one instance
  per process resting on the role that must act next. `jar_for` caches cookie jars by email and
  `inbox_has_task` makes instance seeding idempotent (start only when the role that should hold the
  task has nothing open for that definition) — a demo seeder, not a data synchroniser.
- Adding an endpoint: `openapi/openapi.yaml` → `make contract-generate` → service rule + test →
  store method (+ new migration when schema changes) → handler mapping → `make api-check`.
