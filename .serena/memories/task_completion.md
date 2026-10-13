# Definition of done

- Full gate, must pass: `make quality-check`.
  - `make api-check`: gofmt check, `go mod tidy` diff, `go vet`, `make contract-check`
    (regenerates Go + TS contract types and diffs), golangci-lint, `govulncheck`, `gosec`
    (excluding generated `internal/api/v1`), `go test ./...`, builds both binaries.
  - `make web-check`: eslint, `prettier --check`, `tsc --noEmit`, vitest, `next build`.
  - `actions-lint`: actionlint over `.github/workflows` (actions must stay SHA-pinned).
  - `docs-check`: required files exist (README, AGENTS, LICENSE, SECURITY, CONTRIBUTING,
    CODE_OF_CONDUCT, docs/README) and every local Markdown link resolves (`scripts/check-docs.mjs`).
- CI is GitHub Actions and runs this same gate plus an integration job (`make docker-up` →
  migrate → `make smoke-api`). A change that passes locally but breaks a workflow still fails CI,
  so run `make actions-lint` after touching `.github/` and keep workflows calling Makefile targets.
- End-to-end check available locally: `make smoke-api` (requires Postgres running and migrations
  applied; it builds and starts its own API instance, so stop any dev server first).
- Run formatters BEFORE the gate, it fails on formatting: `gofmt -w` for Go,
  `cd apps/web && pnpm format` for web.
- Contract changes: edit `openapi/openapi.yaml`, run `make contract-generate`, commit the
  regenerated Go + TS files in the same change. `api-check` fails otherwise.
- A dependency with a known vulnerability fails the gate (`govulncheck` runs inside api-check);
  upgrade the dependency instead of suppressing (already happened once for golang.org/x/text).
- New behavior needs tests: Go service tests for rules/validation
  (`internal/service/*_test.go` with fake stores), Vitest + Testing Library for web
  components/utilities (`apps/web/__tests__/`).
- Behavior changes update the docs they touch in the same change (README, `.env.example`, docs/);
  new durable decisions get an ADR (`mem:conventions`).
- Do not leave dev servers or background processes running; verify ports are free
  (`mem:suggested_commands`).

## GitHub-side gate (not in the repo, easy to forget)

- `main` is protected by the ruleset `main protection` (Settings → Rules): pull request required,
  linear history, no force push, no deletion, and four required status checks matched by exact job
  name — `Quality gate (lint, types, tests, build)`, `API integration (PostgreSQL + smoke test)`,
  `Analyze (go)`, `Analyze (javascript-typescript)`.
  Renaming a CI or CodeQL job therefore blocks PRs with "Expected — waiting for status to be
  reported" until the ruleset is updated: change job names and the ruleset in the same effort.
- The repository admin role is an always-bypass actor, so the owner can still push directly to
  `main` and merge without waiting; non-admin collaborators and fork PRs cannot.
- Merge commits are disabled repo-wide (squash or rebase only) to match the linear-history rule.
