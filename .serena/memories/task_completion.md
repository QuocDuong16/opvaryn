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
  migrate → `make smoke-api` → `make smoke-demo-flows`). A change that passes locally but breaks a
  workflow still fails CI, so run `make actions-lint` after touching `.github/` and keep workflows
  calling Makefile targets. The integration job keeps its name because the branch ruleset requires
  it verbatim.
- End-to-end checks available locally: `make smoke-api` (requires Postgres running and migrations
  applied; it builds and starts its own API instance, so stop any dev server first) covers business
  objects, records, the error branches, definition versioning, the process runtime (start → approve
  → condition branch → complete, return → attempt 2, reject terminal, wrong role 403, double
  decision 409) and identity (useradm bootstrap, login, 401 without a session, 403 for a task the
  user does not hold, logout); `make smoke-demo-flows` builds and starts both servers
  and replays the web forms (record entry, object builder, dashboard layout) against a production
  build; `make seed-demo` (needs the API running) loads the demo dataset through the same
  endpoints.
- Run formatters BEFORE the gate, it fails on formatting: `gofmt -w` for Go,
  `cd apps/web && pnpm format` for web.
- Contract changes: edit `openapi/openapi.yaml`, run `make contract-generate`, commit the
  regenerated Go + TS files in the same change. `api-check` fails otherwise.
- A dependency with a known vulnerability fails the gate (`govulncheck` runs inside api-check);
  upgrade the dependency instead of suppressing (already happened once for golang.org/x/text).
- New behavior needs tests: Go service tests for rules/validation
  (`internal/service/*_test.go` with fake stores), Vitest + Testing Library for web
  components/utilities (`apps/web/__tests__/`). Pure demo logic (task reducer, form-value
  conversion, field-draft serialization) is unit tested; there is no browser automation in this
  environment, so interactive flows are verified by replaying the form's progressive-enhancement
  POST against the dev server.
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
- `main` keeps **one commit per change** (about 60 granular commits, subjects like
  `fix(web): …`), so merge a feature branch with `--rebase`, not `--squash`: a squash collapses
  the ADR-by-ADR story into one commit and loses it.
- GitGuardian Security Checks is a repository check but **not** one of the four required ones, so a
  finding there does not block a merge — read it anyway before merging. It scans the whole PR diff
  including every commit, so a secret committed and later fixed still fails the check: the fix must
  remove the literal from the branch's *history*, not only from its tip. Purging it means rewriting
  the branch (`git filter-branch --tree-filter`), force-pushing with
  `--force-with-lease=<branch>:<old-sha>`, and letting CI re-run. The branch is not merged yet at
  that point, so the rewrite is contained; after the merge it would be permanent in `main`.
- A secret literal in a test script does not need to be a real credential to be flagged: GitGuardian
  reported a base64 AES key that was obviously a test value. Generate such keys at run time
  (`head -c 32 /dev/urandom | base64`) rather than committing them.
