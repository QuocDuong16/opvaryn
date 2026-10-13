# Toolchain and dependencies

- Pinned by mise (`mise.toml` + committed `mise.lock`): go 1.27.2, node 26.9.0, pnpm 12.12.0,
  plus Go analysis tools (gopls 0.23.0, govulncheck 1.8.0, gosec pinned revision,
  golangci-lint 2.14.0). `[tool_alias] pnpm = "github:pnpm/pnpm"` is intentional (aqua registry
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
- PostgreSQL 18 in `deployments/docker-compose.yml`, image pinned by digest (same digest as the
  sibling repos so one update covers the family). Application processes run on the host, not in
  containers — container images await the open deployment decision (playbook D10).
- CI and update tooling: GitHub Actions workflows pin every action by full commit SHA (with a
  version comment); `actionlint` is pinned in mise.toml and runs inside `make quality-check`.
  Dependabot (`.github/dependabot.yml`) covers gomod, npm, github-actions and docker-compose
  weekly — it does NOT cover the mise pins (go, node, pnpm, Go tools) or image digests, which are
  updated by hand. Never add `renovate.json` or `.forgejo/`: sibling-repo tooling that does not
  apply here.
