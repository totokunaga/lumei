# CLAUDE.md (backend)

Go API server for Lumei: Gin, Bun ORM on PostgreSQL, slog, google/wire, golang-migrate. It runs as one ECS task behind the ALB (see `docs/architecture/aws-infrastructure.md`). Module path: `github.com/totokunaga/lumei/backend`.

## Commands

Run every command from `backend/`. Codegen, lint, tests, and migrations run in Docker via `docker-compose.tool.yml`, so tool versions are pinned no matter what is installed locally.

```bash
make up-d            # Migrate Postgres while building the API image, then start the API with hot reload (Air) in the background; API on localhost:18080
make down            # Stop containers
make run             # Run the server on the host against the compose Postgres (needs `make up-d`)
make test            # All tests with coverage, against a throwaway Postgres
make test TEST_FLAGS="-run TestName"  # One test
make lint            # golangci-lint v2 (lint-fix to auto-fix)
make generate        # typespec → oapi-codegen → wire → mockgen
make migrate-create NAME=<name>  # New migration pair from migration/template.*.sql
make migrate-up      # Apply migrations to the dev database (also migrate-down, migrate-status, migrate-validate)
make help            # Every target
```

| Port  | What                                      |
|-------|-------------------------------------------|
| 18080 | API in the dev container (`make up-d`)    |
| 15432 | Dev Postgres (`make up-d`)                |
| 25432 | Test Postgres (`make test`, in RAM)       |

## Configuration

- All config is read from environment variables in `internal/config/config.go` with `caarlos0/env` tags (`env:"NAME" envDefault:"..."`). Add new settings there, grouped into a sub-config struct, and expose it through a `Provide*Config` extractor in `internal/di/providers.go`.
- Credentials and secrets get no `envDefault`. Reject empty values in a `Validate()` method called from `Load()`.
- Local values live in `.env.dev`, injected by dotenvx (`make up-d`, `make run`). Encrypt secrets with `dotenvx set KEY value -f .env.dev`. Never commit `.env.keys`.
- When adding a variable the API container needs, also pass it through in `docker-compose.dev.yml`.

## Workflow

### Adding an endpoint

1. Define the route and models in `api/typespec/<feature>.tsp` and import it from `api/typespec/main.tsp`.
2. Run `make oapi-codegen`. This regenerates `api/index.yaml` and `internal/interface/generated/api.gen.go`.
3. Declare the ports the use case needs and implement the use case in `internal/application/<feature>.go`.
4. Implement the ports in `internal/infrastructure/` (e.g. a repository in `database/rdb/repository/`).
5. Implement the new `generated.ServerInterface` methods in `internal/interface/controller/<feature>.go`. Add the use case to `APIControllerInput`.
6. Wire the providers in `internal/di/providers.go` and `internal/di/wire.go`, then run `make wire`.
7. Add a `mockgen` line for the new port file to the `mockgen` service in `docker-compose.tool.yml`, then run `make mockgen`.
8. Add a `Test<OperationId>` function to `test/integration/<tag>_test.go` with its positive and negative cases. Then add unit tests for any branch those cases can't reach (see [Testing](#testing)).
9. Run `make test` and `make lint`.

### Migrations

- Create files only with `make migrate-create NAME=<snake_case_name>`. Every version needs exactly one `.up.sql` and one `.down.sql`; `make migrate-validate` checks this.
- Keep the `BEGIN; ... COMMIT;` wrapper from the template, and make every down migration fully reverse its up migration.
- Never edit a migration that has been applied in a shared environment. Add a new one instead.

## Architecture

Clean Architecture with dependency inversion:

```
interface/controller → application ← infrastructure/
                       (ports defined here)
```

| Package | Role | May import |
|---------|------|-----------|
| `internal/application/` | Use cases and the interfaces (ports) they need | stdlib and pure libraries only |
| `internal/interface/controller/` | HTTP handlers implementing `generated.ServerInterface` | `application`, `interface/generated` |
| `internal/infrastructure/...` | Port implementations: `database/rdb` (connector, repositories), `database/migration`, `logger`, `router` | `application`, `config`, other infrastructure packages |
| `internal/di/` | Wire providers; the only place layers meet | everything |
| `cmd/` | Entry points (`cmd/main.go` server, `cmd/migrate` CLI) | `di`, `config`, infrastructure |

- `internal/application/` must NOT import `internal/infrastructure/...`, `internal/interface/...`, or `internal/di/`.
- `internal/interface/controller/` must NOT import `internal/infrastructure/...`.
- Assert interface conformance at compile time next to the implementation: `var _ application.HealthCheck = (*HealthProbe)(nil)`.
- Process-global side effects (`gin.SetMode`, `slog.SetDefault`, `os.Exit`) live only in `cmd/main.go`, so the parallel per-case `di.InitializeAppWithConfig()` calls in tests never race. Constructors and providers must not touch globals.
- To add a dependency to `GET /health/full`, implement `application.HealthCheck` in infrastructure and register it in `ProvideHealthChecks`. Mark it `Critical()` only if no route works without it.

## Code style

- Import groups: stdlib, third-party, then `github.com/totokunaga/lumei/backend`.
- Every exported identifier needs a GoDoc comment (enforced by revive). Keep comments short.
- Log with the `*Context` methods (`InfoContext`, `ErrorContext`, ...) inside a request so lines carry the `request_id`. Never log secrets; keys like `password` or `token` are redacted as a backstop only.
- Wrap errors with context: `fmt.Errorf("failed to ...: %w", err)`.
- Don't edit generated files: `api/index.yaml`, `internal/interface/generated/`, `internal/mock/`, `internal/di/wire_gen.go`.

## Testing

### Table-driven tests (always)

Write every test, integration and unit alike, as a table-driven test:

- **One table per test function:** a slice of the layer's case struct, one element per case. Even a function with a single case uses a one-element table, so the next case is a new element, not a rewrite.
- **Run the table with the layer's runner** (`runIntegrationTestCases`, `runUseCaseTestCases`, `runControllerTestCases`, `runRepositoryTestCases`). Don't write the `for _, tt := range tests { t.Run(...) }` loop by hand, and don't write standalone `t.Run` blocks or a separate top-level function for one more case.
- **Keep the logic in the runner and the fields.** A case states its input, setup, and expected result as data. Put per-case behavior in the case's `setupMocks`, `setupFunc`, `env`, or `assertFunc` fields, not in `if tt.name == ...` branches.
- **If the case struct can't express what a test needs,** add a field to the layer's case struct and handle it in its runner in `helpers_test.go`, rather than writing that test outside the table. If code outside these layers needs tests (e.g. `internal/infrastructure/router`), give its package the same pattern: a `helpers_test.go` with a case struct and a runner.

### Parallel tests (always)

Run every test in parallel, integration and unit alike. Lint enforces this with `paralleltest` and `tparallel`.

- **Call `t.Parallel()` first in every top-level test function,** before building the table. The layer runners call it for each case, so a case runs alongside every other case and every other test in the package.
- **Never change process-wide state in a test:** no `t.Setenv`, `os.Setenv`, `os.Chdir`, `gin.SetMode`, `slog.SetDefault`, or writes to package-level variables. Go refuses `t.Setenv` in a parallel test, and the other state would leak into tests running at the same time.
  - To change a setting, change the case's own config instead. Integration cases do this in `configure` or `setupFunc` (e.g. `cfg.Server.HealthCheckTimeout = time.Nanosecond` rather than `HEALTH_CHECK_TIMEOUT=1ns`).
  - Defaults the whole suite needs go in `TestMain`, which runs before any test starts (`setEnvDefaults`, `gin.SetMode(gin.TestMode)`).
- **Give each case its own resources:** fresh mocks, its own server, and, if it changes data, its own data. Make the data unique to the case (e.g. a random email or ID, or a disposable database like `useDisposableDatabase`), and never assume a table is empty or holds only the case's rows. Never delete or truncate data other cases might be using.
- **Don't wait on wall-clock time** (`time.Sleep`) to order events. Parallel runs are slower and less predictable. Synchronize on the event itself, or make the timeout tiny or huge so the outcome is certain.
- **If a test truly can't be parallel,** say why at the call site: `//nolint:paralleltest // <reason>`. "It was easier" is not a reason. First try moving the shared state into the case.

### What to test where

1. **Integration tests come first.** Cover as many lines of the Go code as possible from `test/integration/`, with both positive cases (success responses) and negative cases (validation errors, not found, conflicts, and every other error response the endpoint can return). They build the server through the production wiring (`di.InitializeAppWithConfig`, the same graph as `di.InitializeApp` with the config passed in) and call it over HTTP against a real, migrated Postgres, so one case covers the controller, use case, repository, and router together.
2. **Unit tests cover only what integration tests can't reach.** Every remaining branch must be covered by a unit test in the controller, application, or repository layer. Typical examples:
   - a state production wiring can't produce, e.g. the `degraded` health status, which needs a non-critical check that doesn't exist yet (`internal/application/healthcheck_test.go`, `internal/interface/controller/health_test.go`)
   - a driver error a repository must translate or wrap, e.g. a dropped connection or a failed `RowsAffected` (repository, with go-sqlmock)

   Try an integration case first, even for failures. E.g. the database-down and timeout 503s of `GET /health/full` are integration cases: one drops a disposable database after startup, the other sets the case's health-check timeout to `1ns`.
3. **Don't duplicate.** If an integration test already covers a branch, don't also unit-test it.

After `make test`, read the per-package coverage table it prints. Find each uncovered line in `coverage.out` (`go tool cover -html=coverage.out`), then cover it with an integration case if an HTTP request can reach it, or a unit test if not.

- `make test` starts `postgres-for-test`, applies `migration/` with `migrate-for-test`, then runs `scripts/run-tests.sh`. That script uses `-race -shuffle=on`, so tests must not depend on order or share mutable state (see [Parallel tests](#parallel-tests-always)).
- Packages listed in `test/excluded.txt` (`cmd`, `internal/di`, generated code, mocks) are excluded from tests and coverage.

### Integration tests

Organize them by the OpenAPI spec in `api/index.yaml`:

- **One file per tag:** `test/integration/<tag>_test.go`. E.g. every operation tagged `health` goes in `health_test.go`. A new tag in the TypeSpec `@tag(...)` means a new file. An operation with several tags goes in the file for its first tag.
- **One test function per path and method pair**, named `Test` + the operation's `operationId` with the first letter capitalized. E.g. `GET /health` (`getHealth`) is `TestGetHealth`, and `GET /health/full` (`getHealthFull`) is `TestGetHealthFull`.
- **All of an endpoint's cases go in one table inside its test function,** positive and negative alike, run with `runIntegrationTestCases`. Don't add separate top-level functions or hand-written `t.Run` blocks for one endpoint's cases.
- Shared request helpers and fixtures go in `test/integration/helpers_test.go`, not in a tag file. Assertions specific to one tag (e.g. `assertHealthyDatabase`) stay in that tag's file.

| Tag | File | Test functions |
|-----|------|----------------|
| `health` | `health_test.go` | `TestGetHealth` (`GET /health`), `TestGetHealthFull` (`GET /health/full`) |

Update this table when you add a tag or an endpoint.

Each case is a `testIntegrationInput` (`test/integration/helpers_test.go`):

| Field | Purpose |
|-------|---------|
| `name` | Subtest name, starting with the expected status, e.g. `"503 when the database goes away after startup"`. |
| `req` | `method`, `path`, and `headers` to send. |
| `configure func(cfg)` | Changes the case's own `*config.Config` before the server is built, e.g. `func(cfg *config.Config) { cfg.Server.HealthCheckTimeout = time.Nanosecond }`. |
| `setupFunc func(t, cfg) (afterStart func())` | Runs before the server is built and may also change `cfg`. The returned function runs after it starts, before the request, e.g. `useDisposableDatabase` points `cfg` at a new database and drops it there. |
| `expectedStatus` | The response status. The runner always checks it. |
| `assertFunc func(t, response)` | Checks the body and headers. Use `assertBody(want)` for exact bodies, `assertHeader(key, want)` for headers, and `assertAll(...)` to combine them. Write a custom one for bodies with measured values (timestamps, counters). |

- `runIntegrationTestCases` runs the cases in parallel. For each case it loads a fresh config from the environment, applies `configure` and `setupFunc`, and builds a server with `newTestServer(t, cfg)` (`test/integration/setup_test.go`): production wiring served over `httptest` and cleaned up through `t.Cleanup`.
- `TestMain` sets `gin.TestMode` and fills in suite-wide default env vars with `setEnvDefaults`, before any test starts. Per-case overrides go in the case's `configure`, never in env vars.
- Decode bodies into the `generated.*` types with `decode[T]`, so the tests check the API contract.

### Unit tests: table-driven harness

Each layer has a `helpers_test.go` with a generic case struct and runner (see [Table-driven tests](#table-driven-tests-always)):

| Layer | Package | Case struct | Runner | Test doubles |
|-------|---------|-------------|--------|--------------|
| Use case | `internal/application` (`application_test`) | `testUseCaseInput[I, O, M]` | `runUseCaseTestCases` | gomock mocks from `internal/mock` |
| Controller | `internal/interface/controller` (`controller`) | `testControllerInput[M]` | `runControllerTestCases` | gomock mocks + a Gin engine with `generated.RegisterHandlers` |
| Repository | `internal/infrastructure/database/rdb/repository` (`repository`) | `testRepositoryInput[I, O, M]` | `runRepositoryTestCases` | `*bun.DB` backed by go-sqlmock |

Type parameters: `I` is the input, `O` the output, and `M` a struct holding the test's mocks.

Every case struct has these fields:

| Field | Purpose |
|-------|---------|
| `name` | Subtest name. Describe the behavior, e.g. `"503 when a critical check fails"`. |
| `setupMocks func(M)` | Set mock expectations (gomock `EXPECT()`, sqlmock `ExpectQuery`). |
| `setupFunc func()` | Optional extra setup before the call. |
| `assertFunc` | Check the result. Use a shared helper when one fits. |

The use case and repository cases add `input I`, `expectedOutput O`, and `expectedErrMsg string`. The controller case uses `req` (method, path, headers, body or `rawBody`), `expectedResp resp` (status, body), and `parseRespBodyFunc`.

How to write one:

1. Define the mocks struct, e.g. `type healthMocks struct{ checker *mock.MockHealthChecker }`.
2. Write a `newTestEnv` that builds fresh mocks from the `*gomock.Controller` (the controller version also returns a `*gin.Engine` with the handlers registered). The repository version receives a `*bun.DB` and `sqlmock.Sqlmock` instead.
3. List the cases, then call the runner. Use cases and repositories also need an `execute(ctx, mocks, input) (O, error)` function that calls the code under test.

The runners call `t.Parallel()` for each case, build fresh mocks per case, and turn a panic into a returned error. The repository runner also fails the case if any sqlmock expectation was not met.

Shared assert helpers:

| Layer | Helpers |
|-------|---------|
| Use case | `assertOutput`, `assertError`, `assertNoResultSuccess`, `assertNoResultError`, `assertSentinelError(sentinel, notWrapped...)`, `assertValidationError`, `outputPtr`, `ptr` |
| Controller | `parseResponseBodyPtr[T]` (pass as `parseRespBodyFunc`), `assertBody[T]`, `assertNoContent`, `newTestContext` (calling a handler directly, only for branches the router can't reach) |
| Repository | `assertOutput`, `assertError`, `assertErrorOnly`, `assertSentinel(sentinel)`, `assertWrappedNotSentinel(sentinels...)`, `emptyEnvSetup`, `newRepositoryMockDB` |

- Write a custom `assertFunc` only when a shared helper can't express the check, e.g. `assertHealthReport` ignores measured timings.
- Assert errors by identity (`errors.Is` via `assertSentinel` / `assertSentinelError`) when callers branch on them. Use message matching only for errors that are just wrapped.
- Use a fixed `time.Time` in expected values. Never compare against `time.Now()`.
- Add a new helper to the layer's `helpers_test.go` when two or more test files need it. Lint skips `helpers_test.go`, so a helper with no users yet doesn't fail lint.
