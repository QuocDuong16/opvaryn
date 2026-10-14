# apps/api — Go service (module `github.com/QuocDuong16/opvaryn/api`)

Entry points: `cmd/server` (HTTP server, signal-aware graceful shutdown) and `cmd/migrate`
(migration runner). Both read config through `internal/config`.

## HTTP surface (`internal/httpapi`)

- `NewRouter(cfg, store, httpapi.Services{BusinessObjects, ObjectRecords}, logger)` wires
  middleware: chi RequestID, custom `requestLogger` (structured, request-id correlated),
  Recoverer, CORS from `CORS_ALLOWED_ORIGINS`. `middleware.RealIP` is intentionally NOT used
  (spoofing advisories) — do not add it back without a trusted-proxy design.
- `respond.go` owns the error envelope, the `code*` constants, and `decodeJSON` (1 MiB cap,
  DisallowUnknownFields, rejects trailing content). Unknown routes/methods also return the JSON
  envelope.
- Implemented: `GET /healthz`, `GET /readyz` (2s DB ping timeout → 503 `unavailable`),
  `GET /api/v1/meta` (from `internal/buildinfo`), `GET/POST /api/v1/business-objects`,
  `GET/PUT /api/v1/business-objects/{key}` (PUT publishes the next immutable version),
  `GET /api/v1/business-objects/{key}/versions` (newest first) and
  `GET/POST /api/v1/business-objects/{key}/records` (each record reports `objectVersion`).
- Process runtime (ADR 0007): `GET/POST /api/v1/process-definitions`,
  `GET/PUT /api/v1/process-definitions/{key}`, `GET .../versions`,
  `POST /api/v1/process-instances` (start from a stored record),
  `GET /api/v1/process-instances/{id}` (instance + tasks + event log) and
  `POST /api/v1/process-instances/{id}/tasks/{taskId}/decisions`.
- Identity (ADR 0008): `POST /api/v1/auth/login` (sets the httpOnly `opvaryn.session` cookie),
  `POST /api/v1/auth/logout` (204) and `GET /api/v1/me`. `sessionMiddleware` resolves the cookie
  once per request into the request context; `requireUser` answers 401. The runtime endpoints
  (start instance, decide task, read instance) require a session, and the decision's actor and
  roles come from the authenticated user — `actorRole`/`actor` are gone from the request bodies.
- Error mapping lives in `writeStoreError`: `ValidationError` → 400, `store.ErrNotFound` → 404,
  `store.ErrConflict`/`ErrTaskClosed`/`service.ErrStateConflict` → 409, `service.ErrForbidden` → 403
  (the user does not hold the role, D08b), `service.ErrUnauthorized` → 401 `unauthorized`,
  `store.ErrUnavailable` → 503. `parseUUIDParam` turns a malformed path id into a 400 instead of a
  zero UUID.
- `system.go` = health/readiness/meta handlers; `businessobject.go` = list/create/get handlers
  plus the domain ↔ `apiv1` mapping helpers (`toAPIBusinessObject` including optional select
  `options`, `toDomainFields`, `pointerOrNil`/`stringValue` for optional fields);
  `objectrecord.go` = record handlers + `toAPIObjectRecord(s)`.
- `writeStoreError` in `businessobject.go` is the single error mapper for every handler: service
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
  `SetPassword`/`ListUsers` never expose hashes. Accounts come from `cmd/useradm`
  (`make useradm ARGS="-create ..."`), because the first user cannot be created through the API.
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
- Migrations: `0001_business_objects.sql` (definitions), `0002_business_object_records.sql`
  (`object_id` FK with ON DELETE CASCADE, `values` JSONB object, index on `(object_id,
  created_at DESC)`), `0003_definition_versions.sql` (version table, backfills every existing
  definition as v1 keeping `created_at` as `published_at`, binds existing records to their v1,
  then drops `business_objects.fields`), `0004_process_runtime.sql` (`process_definitions`,
  `process_definition_versions`, `process_instances` with a state/finished_at consistency check,
  `process_tasks` with a partial unique index on one open task per node+attempt and a CHECK that
  returned/rejected tasks carry a reason, `process_events`), `0005_identity.sql` (`departments` as a
  closed catalogue, `users` with lower-cased emails and a NOT NULL department, `user_roles`,
  `sessions` storing only the token hash).
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
  including option rules) and `internal/service/objectrecord_test.go` (value validation per field
  type, normalization, `ErrNotFound` propagation); fake stores assert invalid input never reaches
  persistence.
- `scripts/smoke-api.sh` (`make smoke-api`) exercises every endpoint against real PostgreSQL,
  including record creation, the unknown-key/option/required/duplicate branches, the 404 envelope,
  publishing a definition version, the version history order, that records keep the version they
  were created under, and the whole identity + runtime path (it bootstraps a department and two
  users with `useradm`, logs in, asserts 401 without a session, 403 for a task the user does not
  hold, 409 on a second decision and that the audit is attributed to the signed-in user);
  `scripts/seed-demo.sh` (`make seed-demo`) seeds demo data through the API.
- Adding an endpoint: `openapi/openapi.yaml` → `make contract-generate` → service rule + test →
  store method (+ new migration when schema changes) → handler mapping → `make api-check`.
