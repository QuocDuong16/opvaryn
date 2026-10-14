# Makefile — opvaryn

.DEFAULT_GOAL := help

.PHONY: help install dev dev-api dev-web \
        docker-up docker-down docker-logs docker-logs-tail docker-config docker-clean \
        images-build pilot-up pilot-down pilot-logs backup restore-drill \
        contract-generate contract-check \
        api-tools-check api-fix api-build api-test api-lint api-vuln api-check \
        useradm \
        smoke-api smoke-demo-flows smoke-restart seed-demo \
        web-install web-lint web-format web-typecheck web-test web-build web-check \
        actions-lint docs-check quality-check clean

##@ Getting started
help: ## Show the documented Make targets
	@awk 'BEGIN { FS = ":.*##"; printf "Usage: make <target> [VAR=value...]\n" } /^##@/ { if (shown++) printf "\n"; printf "%s\n", substr($$0, 5); next } /^[a-zA-Z0-9_.-]+:.*##/ { printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install Go modules and web dependencies
	cd apps/api && go mod download
	pnpm install

dev: ## Run the API and web dev servers together
	$(MAKE) -j2 dev-api dev-web

dev-api: ## Run the Go API dev server (needs Postgres: make docker-up)
	cd apps/api && go run ./cmd/server

dev-web: ## Run the Next.js dev server on http://localhost:21500
	cd apps/web && pnpm dev

##@ Docker Compose
DOCKER_COMPOSE = docker compose -f deployments/docker-compose.yml --project-directory .

docker-up: ## Start local Postgres and wait until it reports healthy
	$(DOCKER_COMPOSE) up -d --wait

docker-down: ## Stop local services
	$(DOCKER_COMPOSE) down

docker-logs: ## Follow local service logs
	$(DOCKER_COMPOSE) logs -f

docker-logs-tail: ## Print the recent logs and exit (used by CI when a step fails)
	$(DOCKER_COMPOSE) logs --tail=200 --no-log-prefix

docker-config: ## Validate the effective Docker Compose configuration (both modes)
	$(DOCKER_COMPOSE) config
	@$(DOCKER_COMPOSE) --profile pilot config --quiet && echo "pilot profile: config valid"

docker-clean: ## Stop services and delete Compose volumes
	$(DOCKER_COMPOSE) down -v --remove-orphans

##@ Deployment (one internal host, ADR 0009)

images-build: ## Build the API and web images without starting anything
	$(DOCKER_COMPOSE) --profile pilot build

pilot-up: ## Start the whole product on this host (migrate, API, web, backup)
	$(DOCKER_COMPOSE) --profile pilot up -d --build --wait

pilot-down: ## Stop the pilot stack, keeping the database volume and dumps
	$(DOCKER_COMPOSE) --profile pilot down

pilot-logs: ## Follow the pilot stack logs
	$(DOCKER_COMPOSE) --profile pilot logs -f --tail=50

backup: ## Write a verified dump now (one-off run of the backup job)
	$(DOCKER_COMPOSE) --profile pilot run --rm --entrypoint /bin/sh backup -c 'sh /usr/local/bin/backup-db.sh'

restore-drill: ## Restore the newest dump into a scratch database and prove the API serves it
	bash scripts/restore-drill.sh

##@ API contracts

# The OpenAPI document is the single source of truth for the API contract.
# Generated Go and TypeScript types are committed; regenerate after edits.
contract-generate: ## Regenerate the Go and TypeScript contract types
	cd apps/api && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0 \
		-generate models -package apiv1 \
		-o internal/api/v1/types.gen.go openapi/openapi.yaml
	cd packages/contracts && pnpm api:generate

contract-check: ## Check generated contract types are fresh
	@echo "Check generated Go types freshness..."
	@cd apps/api && output="$$(mktemp)"; \
	trap 'rm -f "$$output"' EXIT; \
	go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0 \
		-generate models -package apiv1 -o "$$output" openapi/openapi.yaml; \
	diff -u internal/api/v1/types.gen.go "$$output"
	@echo "Check generated TypeScript types freshness..."
	cd packages/contracts && pnpm api:check

##@ Go API

# Analysis tools are pinned in mise.toml and resolved through mise.lock.
# Local and CI share the same toolchain definition.
api-tools-check: ## Verify mise-managed Go analysis tools are installed
	@command -v mise >/dev/null 2>&1 || { echo "Missing mise — install mise, then run 'mise install'." >&2; exit 1; }
	@for tool in gopls govulncheck gosec golangci-lint; do \
		if ! mise which "$$tool" >/dev/null 2>&1; then \
			echo "Missing mise-managed $$tool — run 'mise install' first." >&2; \
			exit 1; \
		fi; \
	done

api-fix: ## Tidy Go modules and format Go sources
	cd apps/api && go mod tidy && go fmt ./...

api-build: ## Build the API, migrate and useradm binaries
	cd apps/api && go build -o bin/server ./cmd/server
	cd apps/api && go build -o bin/migrate ./cmd/migrate
	cd apps/api && go build -o bin/useradm ./cmd/useradm

useradm: ## Administer users and departments (e.g. make useradm ARGS="-list")
	cd apps/api && go run ./cmd/useradm $(ARGS)

api-test: ## Run Go API tests
	cd apps/api && go test ./...

api-lint: api-tools-check ## Lint the Go API
	cd apps/api && mise exec -- golangci-lint run ./...

api-vuln: api-tools-check ## Check Go vulnerabilities and security findings
	cd apps/api && mise exec -- govulncheck ./...
	cd apps/api && mise exec -- gosec -exclude-dir=internal/api/v1 ./...

api-check: api-tools-check ## Run Go API contract, format, lint, security, and test checks
	@echo "Check formatting..."
	cd apps/api && test -z "$$(gofmt -l .)"
	@echo "Check tidy..."
	@cd apps/api && before="$$(mktemp)"; trap 'rm -f "$$before"' EXIT; \
	cp go.mod "$$before"; go mod tidy; diff -u "$$before" go.mod
	@echo "Check vet..."
	cd apps/api && go vet ./...
	@echo "Check contract..."
	$(MAKE) contract-check
	@echo "Check lint..."
	$(MAKE) api-lint
	@echo "Check vulnerabilities and security..."
	$(MAKE) api-vuln
	@echo "Test..."
	cd apps/api && go test ./...
	@echo "Build..."
	$(MAKE) api-build

##@ Web app

web-install: ## Install web dependencies
	pnpm install

web-lint: ## Lint the Next.js web app
	cd apps/web && pnpm lint

web-format: ## Format web sources
	cd apps/web && pnpm format

web-typecheck: ## Typecheck the web app
	cd apps/web && pnpm typecheck

web-test: ## Run web unit tests
	cd apps/web && pnpm test

web-build: ## Build the Next.js web app
	cd apps/web && pnpm build

web-check: ## Run web lint, format, type, test, and build checks
	@echo "Check frontend lint..."
	cd apps/web && pnpm lint
	@echo "Check frontend format..."
	cd apps/web && pnpm format:check
	@echo "Check frontend types..."
	cd apps/web && pnpm typecheck
	@echo "Run frontend tests..."
	cd apps/web && pnpm test
	@echo "Check frontend build..."
	cd apps/web && pnpm build

##@ Repository checks

smoke-api: ## Build the API, start it and smoke test it against local Postgres
	bash scripts/smoke-api.sh

smoke-restart: ## Prove a crash does not lose workflow state and a retry cannot apply twice
	bash scripts/smoke-restart.sh

smoke-demo-flows: ## Build both servers, start them and smoke test the web demo flows
	bash scripts/smoke-demo-flows.sh

seed-demo: ## Seed the demo business objects and records through the running API
	bash scripts/seed-demo.sh

actions-lint: ## Lint the GitHub Actions workflows
	@command -v mise >/dev/null 2>&1 || { echo "Missing mise — install mise, then run 'mise install'." >&2; exit 1; }
	@mise which actionlint >/dev/null 2>&1 || { echo "Missing mise-managed actionlint — run 'mise install' first." >&2; exit 1; }
	mise exec -- actionlint

docs-check: ## Check documentation links and required docs exist
	node scripts/check-docs.mjs

quality-check: api-check web-check actions-lint docs-check ## Run the full local quality gate

##@ Cleanup
clean: ## Remove build output and dependency trees
	rm -rf apps/web/.next apps/web/out apps/web/coverage apps/api/bin
	rm -f apps/api/server apps/api/migrate

# ─── Load .env ────────────────────────────────────────────────────────────────
ifneq (,$(wildcard .env))
    include .env
    export
endif
