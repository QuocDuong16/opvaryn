# Toolchain and dependencies

- Pinned by mise (`mise.toml` + committed `mise.lock`): go 1.27.4, node 26.13.1, pnpm 12.23.0,
  plus Go analysis tools (gopls 0.24.0, govulncheck 1.10.0, gosec 2.30.0,
  golangci-lint 2.15.0). `[tool_alias] pnpm = "github:pnpm/pnpm"` is intentional (aqua registry
  gap); mirrors the sibling projects' mise.toml.
- Go module `github.com/QuocDuong16/opvaryn/api` (in `apps/api`): chi/v5 router, jackc/pgx/v5
  (`pgxpool`), caarlos0/env/v11, google/uuid. Contract codegen runs as
  `go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0` — a pinned tool
  invocation, not a module dependency (models only).
- Web: Next.js 16 (App Router, Turbopack) + React 19 + TypeScript 6 + Tailwind CSS 4 with the
  two-layer `@theme inline` token mapping. Icons `@phosphor-icons/react` — server components
  must import the SSR entry (`@phosphor-icons/react/dist/ssr`). `clsx` + `tailwind-merge` via
  `cn` in `lib/utils.ts`.
- Web tests/tooling: Vitest 5 + jsdom + Testing Library, ESLint 10 flat config
  (eslint-config-next + eslint-plugin-security + eslint-plugin-no-unsanitized, programmatic
  `no-restricted-syntax` bans on eval/localStorage/document.cookie), Prettier (single quotes,
  width 100, trailing comma all).
- pnpm workspace = `apps/web` + `packages/*`. `packages/contracts` ships raw TypeScript (no build
  step) and is consumed through `transpilePackages: ['@opvaryn/contracts']` in
  `apps/web/next.config.ts`.
- Install scripts are denied by default. Approved native packages are listed in the root
  `pnpm-workspace.yaml` (`onlyBuiltDependencies` + `allowBuilds`: currently @swc/core, sharp,
  unrs-resolver). An unapproved package makes `pnpm install` fail with ERR_PNPM_IGNORED_BUILDS.
- PostgreSQL 18 in `deployments/docker-compose.yml`, image pinned by digest. It diverged from the
  sibling repos when the digest was re-picked after a Trivy scan; do not assume one update covers
  the family. Application processes run on the host, not in containers — container images await
  the open deployment decision (playbook D10).
- Base-image digests are chosen by scanning the candidate tags with Trivy (`trivy image`), not by
  following the floating tag blindly. Some findings cannot be removed by a base-image bump: the
  PostgreSQL image bundles a Go binary with old stdlib CVEs, and the Node image bundles npm
  packages (undici, brace-expansion) with their own advisories. Those need an upstream image
  release; do not "fix" them by editing our app dependencies.
- The Go pin moves in **three places together**: `mise.toml` (`go = "…"`), `mise.lock` (regenerate
  with `mise lock`), and `apps/api/go.mod`'s `go` directive. The Go base image in
  `apps/api/Dockerfile` is a fourth: it is pinned by digest to the exact patch release (tag
  `golang:1.27.4-alpine`), or the build fails with `go.mod requires go >= X (running go Y;
  GOTOOLCHAIN=local)`. A `govulncheck` failure in the standard library is therefore a toolchain
  bump, not a code fix — the fix is the newer Go, and the image digest follows it.
- The Node/pnpm pins also appear in `apps/web/Dockerfile`: the `node:26.13.1-alpine` digest and
  `npm install --global pnpm@…`; keep both in step with `mise.toml` because the pnpm lockfile
  format is version-sensitive. Docs and the `/settings` toolchain line repeat these numbers.
- `mise` shims own `go`, `python3`, `git`-adjacent tools in PATH. A script that runs inside a
  temporary checkout of this repository (e.g. a `git filter-branch` tree filter) will trip mise's
  "config files are not trusted" error, because the copied `mise.toml` is a new path. Call
  `/usr/bin/python3` and `/bin/bash` by absolute path in such scripts.
- CI and update tooling: GitHub Actions workflows pin every action by full commit SHA (with a
  version comment); `actionlint` is pinned in mise.toml and runs inside `make quality-check`.
  Dependabot (`.github/dependabot.yml`) covers gomod, npm, github-actions, docker-compose and the
  two Dockerfiles weekly — it does NOT cover the mise pins (go, node, pnpm, Go tools), which are
  updated by hand. Base-image digests may also be re-picked by hand after a Trivy scan. Never add
  `renovate.json` or `.forgejo/`: sibling-repo tooling that does not apply here.
- Update policy in `.github/dependabot.yml`: `version-update:semver-major` is ignored for gomod,
  npm and docker-compose — majors are deliberate decisions, not notifications (`update-types` only
  affects version updates, so Dependabot alerts and security updates still fire). GitHub Actions
  stays fully automated because action majors must move when a runtime is retired. Dependabot
  groups `github/codeql-action/*` so `init` and `analyze` move in one PR: bumping only one fails
  CodeQL with a version-mismatch configuration error. A major PR that appears anyway means this
  policy was edited — check before "fixing" the config; Dependabot auto-closes its own PRs when a
  new ignore rule applies or when the same/newer version is already on the target branch, but it
  can leave a conflicting PR open when a manual update used a different version or digest.
- Known accepted risk: Dependabot alert (high) on `braces@3.0.3`, reachable only through the dev
  chain `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. It is
  not in the production dependency tree and 3.0.3 is the latest published version, so no patched
  release exists to upgrade to. There is also no upgrade path around it: the newest
  `eslint-config-next` (16.4.0, the version in use) pins `fast-glob` to exactly 3.3.1, which pulls
  `micromatch@4.0.8` → `braces@3.0.3`. Leave it accepted and re-check when braces ships a fix; do
  not "resolve" it by downgrading or dropping `eslint-config-next`.
- Typescript 7 (native compiler) is currently incompatible with the toolchain:
  `openapi-typescript@7.13.0` crashes with `createKeywordTypeNode` undefined, breaking
  `make contract-check`. Do not accept a TS 7 bump until openapi-typescript and the
  Next.js/ESLint stack support it.
