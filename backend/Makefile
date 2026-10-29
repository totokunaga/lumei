.PHONY: help up up-d up-deps up-migrate up-build down build logs ps clean wire typespec oapi-codegen mockgen generate lint lint-fix build-bin run tidy env test test-down migrate-create migrate-up migrate-down migrate-down-all migrate-status migrate-validate migrate-dry-run

# Environment file consumed by dotenvx. Override with `make run ENV_FILE=.env.other`.
ENV_FILE ?= .env.dev
export ENV_FILE

# dotenvx injects the variables from ENV_FILE, decrypting them when they are
# encrypted. .env.keys holds the private decryption keys and is only needed
# once values are encrypted, so it is included only when present.
DOTENVX_RUN = dotenvx run $(if $(wildcard .env.keys),--env-file=.env.keys ,)--env-file=$(ENV_FILE) --

DOCKER_COMPOSE = docker compose -f docker-compose.dev.yml
DOCKER_COMPOSE_TOOL = docker compose -f docker-compose.tool.yml

# Database credential for `make run`, matching the `${RDB_USER:-postgres}`
# fallbacks in the compose files. RDB_USER/RDB_PASSWORD have no default in
# config.RDBConfig, so a deployed task must be handed one.
RDB_USER ?= postgres
RDB_PASSWORD ?= postgres

MIGRATIONS_DIR = migration
# Pass FORCE=yes to skip the destructive-operation confirmation prompt (for CI).
MIGRATE_FORCE_FLAG = $(if $(filter yes,$(FORCE)),--force,)
# Without --force the down/down-all commands prompt interactively, so allocate a
# TTY unless the prompt is being skipped.
MIGRATE_TTY = $(if $(filter yes,$(FORCE)),,-it)

.DEFAULT_GOAL := help

help: ## Display this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# `docker compose up --build` builds every image before starting any container,
# so the migration would wait for the api build. up-deps runs the two in
# parallel instead; up/up-d then start the api without re-running its
# dependencies (--no-deps), since up-deps already did.
up: up-deps ## Migrate Postgres while building the API, then start both in the foreground
	$(DOTENVX_RUN) $(DOCKER_COMPOSE) up --no-deps postgres api

up-d: up-deps ## Migrate Postgres while building the API, then start both in the background
	$(DOTENVX_RUN) $(DOCKER_COMPOSE) up --no-deps -d postgres api

up-deps:
	@$(MAKE) --no-print-directory -j2 up-migrate up-build

# Starts Postgres and the migrate container, and fails if the migration does.
up-migrate:
	$(DOTENVX_RUN) $(DOCKER_COMPOSE) up -d migrate
	$(DOCKER_COMPOSE) wait migrate

up-build:
	$(DOTENVX_RUN) $(DOCKER_COMPOSE) build api

down: ## Stop and remove containers
	$(DOCKER_COMPOSE) down

build: ## Build or rebuild service images
	$(DOCKER_COMPOSE) build

logs: ## Tail container logs
	$(DOCKER_COMPOSE) logs -f

ps: ## List running containers
	$(DOCKER_COMPOSE) ps

clean: ## Remove containers, volumes, and build artifacts
	$(DOCKER_COMPOSE) down -v --remove-orphans
	rm -rf bin tmp coverage.out

wire: ## Generate wire dependency injection code
	$(DOCKER_COMPOSE_TOOL) run --rm wire

typespec: ## Compile TypeSpec sources into api/index.yaml
	$(DOCKER_COMPOSE_TOOL) run --rm typespec

oapi-codegen: typespec ## Compile TypeSpec, then generate API code from the OpenAPI spec
	$(DOCKER_COMPOSE_TOOL) run --rm oapi-codegen

mockgen: ## Generate gomock mocks for application interfaces
	$(DOCKER_COMPOSE_TOOL) run --rm mockgen

generate: oapi-codegen wire mockgen ## Run all code generation

lint: ## Run golangci-lint
	$(DOCKER_COMPOSE_TOOL) run --rm lint

lint-fix: ## Run golangci-lint with auto-fix
	$(DOCKER_COMPOSE_TOOL) run --rm lint-fix

build-bin: ## Build the server binary
	CGO_ENABLED=0 go build -ldflags='-w -s' -o bin/server ./cmd

run: ## Run the server on the host against the compose database (run `make up-d` first)
	RDB_USER=$(RDB_USER) RDB_PASSWORD=$(RDB_PASSWORD) $(DOTENVX_RUN) go run ./cmd

tidy: ## Tidy go.mod/go.sum
	go mod tidy

env: ## Show the decrypted environment variables from ENV_FILE
	@dotenvx get $(if $(wildcard .env.keys),--env-file=.env.keys ,)--env-file=$(ENV_FILE) --format eval

test: ## Run all tests with coverage in a container against the test database
	$(DOCKER_COMPOSE_TOOL) run --rm -e TEST_FLAGS="$(TEST_FLAGS)" test

test-down: ## Stop and remove the test containers
	$(DOCKER_COMPOSE_TOOL) rm -sf test postgres-for-test migrate-for-test

migrate-create: ## Create a new migration file pair (NAME=<name>)
	@if [ -z "$(NAME)" ]; then \
		echo "Error: NAME is required. Usage: make migrate-create NAME=<migration_name>"; \
		exit 1; \
	fi
	@VERSION=$$(date +%Y%m%d%H%M%S); \
	UP_FILE="$(MIGRATIONS_DIR)/$${VERSION}_$(NAME).up.sql"; \
	DOWN_FILE="$(MIGRATIONS_DIR)/$${VERSION}_$(NAME).down.sql"; \
	cp "$(MIGRATIONS_DIR)/template.up.sql" "$$UP_FILE"; \
	cp "$(MIGRATIONS_DIR)/template.down.sql" "$$DOWN_FILE"; \
	echo "Created migration files:"; \
	echo "  $$UP_FILE"; \
	echo "  $$DOWN_FILE"

migrate-up: ## Apply all pending migrations to the dev database
	$(DOCKER_COMPOSE_TOOL) run --rm migrate up

migrate-down: ## Roll back the last migration (FORCE=yes to skip the prompt)
	$(DOCKER_COMPOSE_TOOL) run --rm $(MIGRATE_TTY) migrate down $(MIGRATE_FORCE_FLAG)

migrate-down-all: ## Roll back all migrations (FORCE=yes to skip the prompt)
	$(DOCKER_COMPOSE_TOOL) run --rm $(MIGRATE_TTY) migrate down-all $(MIGRATE_FORCE_FLAG)

migrate-status: ## Show the current migration version and dirty state
	$(DOCKER_COMPOSE_TOOL) run --rm migrate status

migrate-validate: ## Validate migration files without a database connection
	$(DOCKER_COMPOSE_TOOL) run --rm migrate-validate

migrate-dry-run: ## Validate migrations against the dev database without executing them
	$(DOCKER_COMPOSE_TOOL) run --rm migrate up --dry-run
