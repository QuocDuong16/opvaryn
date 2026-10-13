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
  `GET /api/v1/business-objects/{key}` and `GET/POST /api/v1/business-objects/{key}/records`.
- `system.go` = health/readiness/meta handlers; `businessobject.go` = list/create/get handlers
  plus the domain ↔ `apiv1` mapping helpers (`toAPIBusinessObject` including optional select
  `options`, `toDomainFields`, `pointerOrNil`/`stringValue` for optional fields);
  `objectrecord.go` = record handlers + `toAPIObjectRecord(s)`.
- `writeStoreError` in `businessobject.go` is the single error mapper for every handler: service
  `ValidationError` → 400 `invalid_request`, `store.ErrNotFound` → 404 `not_found`,
  `store.ErrConflict` → 409 `conflict`, `store.ErrUnavailable` → 503, else 500.

## Service (`internal/service`)

- `BusinessObjects` wraps the narrow `businessObjectStore` interface (fakeable in tests).
- `Create` validates (`validateNewBusinessObject` → `validateFields`), then normalizes
  (trim) before persisting. Limits: 100 fields, name ≤120, description ≤500, label ≤120,
  50 select options ≤120 chars.
- `FieldDefinition.Options` rules (only the `select` type carries options): select must declare
  at least one option, values must be non-empty/unique after trimming, options on other types are
  rejected.
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
- `businessobject.go`: SQL + scanning; `fields` JSONB ↔ `[]domain.FieldDefinition`;
  `GetBusinessObjectByKey` maps `pgx.ErrNoRows` → `ErrNotFound`.
- `objectrecord.go`: `ListObjectRecords` (ordered `created_at DESC, id`) and `CreateObjectRecord`;
  a foreign-key violation (23503) becomes `ErrNotFound` because the addressed definition was
  deleted concurrently.
- `errors.go`: `classify()` maps `*pgconn.PgError` connectivity (`*pgconn.ConnectError`) to
  `ErrUnavailable`; unique-violation 23505 → `ErrConflict` in the repo method.
- `migrate.go`: `ApplyMigrations` creates `schema_migrations(version, checksum, applied_at)`,
  takes `pg_advisory_lock(hashtext('opvaryn_schema_migrations'))`, applies each
  `sql/migrations/*.sql` in lexical order in one transaction per file, records sha256, and
  refuses when an applied migration's checksum changed. Files are read through `os.DirFS`
  (avoids gosec G304). Run from `apps/api` because of the default `-dir`.
- Migrations: `0001_business_objects.sql` (definitions), `0002_business_object_records.sql`
  (`object_id` FK with ON DELETE CASCADE, `values` JSONB object, index on `(object_id,
  created_at DESC)`).

## Contract and tests

- `internal/api/v1/types.gen.go` is generated (oapi-codegen, models only — path params are read
  with `chi.URLParam`, no params structs exist). Regenerate via `make contract-generate`; never
  edit.
- Tests: `internal/service/businessobject_test.go` (table-driven validation + normalization,
  including option rules) and `internal/service/objectrecord_test.go` (value validation per field
  type, normalization, `ErrNotFound` propagation); fake stores assert invalid input never reaches
  persistence.
- `scripts/smoke-api.sh` (`make smoke-api`) exercises every endpoint against real PostgreSQL,
  including record creation, the unknown-key/option/required/duplicate branches and the 404
  envelope; `scripts/seed-demo.sh` (`make seed-demo`) seeds demo data through the API.
- Adding an endpoint: `openapi/openapi.yaml` → `make contract-generate` → service rule + test →
  store method (+ new migration when schema changes) → handler mapping → `make api-check`.
