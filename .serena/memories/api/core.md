# apps/api — Go service (module `github.com/QuocDuong16/opvaryn/api`)

Entry points: `cmd/server` (HTTP server, signal-aware graceful shutdown) and `cmd/migrate`
(migration runner). Both read config through `internal/config`.

## HTTP surface (`internal/httpapi`)

- `NewRouter(cfg, store, businessObjectsService, logger)` wires middleware: chi RequestID,
  custom `requestLogger` (structured, request-id correlated), Recoverer, CORS from
  `CORS_ALLOWED_ORIGINS`. `middleware.RealIP` is intentionally NOT used (spoofing advisories) —
  do not add it back without a trusted-proxy design.
- `respond.go` owns the error envelope, the `code*` constants, and `decodeJSON` (1 MiB cap,
  DisallowUnknownFields, rejects trailing content). Unknown routes/methods also return the JSON
  envelope.
- Implemented: `GET /healthz`, `GET /readyz` (2s DB ping timeout → 503 `unavailable`),
  `GET /api/v1/meta` (from `internal/buildinfo`), `GET/POST /api/v1/business-objects`.
- `system.go` = health/readiness/meta handlers; `businessobject.go` = list/create handlers plus
  the domain ↔ `apiv1` mapping helpers (`toAPIBusinessObject`, `toDomainFields`,
  `pointerOrNil`/`stringValue` for optional fields).

## Service (`internal/service`)

- `BusinessObjects` wraps the narrow `businessObjectStore` interface (fakeable in tests).
- `Create` validates (`validateNewBusinessObject` → `validateFields`), then normalizes
  (trim) before persisting. Limits: 100 fields, name ≤120, description ≤500, label ≤120.
- `KeyPattern` is the platform-wide machine-key shape: `^[a-z][a-z0-9_]{1,63}$`.

## Store (`internal/store`)

- `Store` wraps `*pgxpool.Pool`; `New` connects lazily so the API starts while the DB is down
  (`Ping`/`readyz` report reality).
- `businessobject.go`: SQL + scanning; `fields` JSONB ↔ `[]domain.FieldDefinition`.
- `errors.go`: `classify()` maps `*pgconn.PgError` connectivity (`*pgconn.ConnectError`) to
  `ErrUnavailable`; unique-violation 23505 → `ErrConflict` in the repo method.
- `migrate.go`: `ApplyMigrations` creates `schema_migrations(version, checksum, applied_at)`,
  takes `pg_advisory_lock(hashtext('opvaryn_schema_migrations'))`, applies each
  `sql/migrations/*.sql` in lexical order in one transaction per file, records sha256, and
  refuses when an applied migration's checksum changed. Files are read through `os.DirFS`
  (avoids gosec G304). Run from `apps/api` because of the default `-dir`.

## Contract and tests

- `internal/api/v1/types.gen.go` is generated (oapi-codegen, models only). Regenerate via
  `make contract-generate`; never edit.
- Tests: `internal/service/businessobject_test.go` (table-driven validation + normalization,
  fake store asserts invalid input never reaches persistence).
- Adding an endpoint: `openapi/openapi.yaml` → `make contract-generate` → service rule + test →
  store method (+ new migration when schema changes) → handler mapping → `make api-check`.
