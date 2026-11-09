// Package di wires application dependencies together.
package di

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb/driver"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb/repository"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/identity"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/logger"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/router"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/secretbox"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/token"
	"github.com/totokunaga/lumei/backend/internal/interface/controller"
)

// App holds the application's core components.
type App struct {
	Router *router.Router
	Logger *slog.Logger
}

// ProvideConfig loads the application configuration from environment variables.
func ProvideConfig() (*config.Config, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// ProvideServerConfig extracts the server configuration.
func ProvideServerConfig(cfg *config.Config) config.ServerConfig {
	return cfg.Server
}

// ProvideRDBConfig extracts the RDB configuration.
func ProvideRDBConfig(cfg *config.Config) config.RDBConfig {
	return cfg.RDB
}

// ProvideLogConfig extracts the logger configuration.
func ProvideLogConfig(cfg *config.Config) config.LogConfig {
	return cfg.Log
}

// ProvideAuthConfig extracts the sign-in and session configuration.
func ProvideAuthConfig(cfg *config.Config) config.AuthConfig {
	return cfg.Auth
}

// ProvideLogger provides a configured slog logger.
func ProvideLogger(cfg config.LogConfig) *slog.Logger {
	return logger.New(cfg)
}

// ProvideDBDriver provides the PostgreSQL driver.
func ProvideDBDriver(cfg config.RDBConfig) rdb.DBDriver {
	return driver.NewPostgresDriver(cfg)
}

// ProvideConnector opens a database connection and returns a cleanup function.
func ProvideConnector(
	cfg config.RDBConfig,
	dbDriver rdb.DBDriver,
	log *slog.Logger,
) (*rdb.Connector, func(), error) {

	connector := rdb.NewConnector(dbDriver, cfg)

	// Bound the initial connect/ping so startup fails fast when the database is
	// unreachable instead of hanging on the OS-level TCP timeout.
	ctx, cancel := context.WithTimeout(context.Background(), cfg.ConnectTimeout)
	defer cancel()

	if err := connector.Open(ctx); err != nil {
		return nil, nil, fmt.Errorf("failed to open database connection: %w", err)
	}
	log.Info("database connection established", "driver", dbDriver.DriverName())

	cleanup := func() {
		if err := connector.Close(); err != nil {
			log.Error("failed to close database connection", "error", err)
			return
		}
		log.Info("database connection closed")
	}

	return connector, cleanup, nil
}

// ProvideHealthChecks provides every dependency's health check, in the order
// GET /health/full reports them. Register a new dependency's check here.
func ProvideHealthChecks(connector *rdb.Connector) []application.HealthCheck {
	return []application.HealthCheck{rdb.NewHealthProbe(connector)}
}

// ProvideHealthChecker provides the checker GET /health/full runs.
func ProvideHealthChecker(
	cfg config.ServerConfig,
	checks []application.HealthCheck,
) application.HealthChecker {

	return application.NewHealthChecker(checks, cfg.HealthCheckTimeout)
}

// ProvideIdentityVerifier provides the verifier of Apple and Google ID
// tokens. Its HTTP client fetches the providers' signing keys.
func ProvideIdentityVerifier(cfg config.AuthConfig) application.IdentityVerifier {
	return identity.New(cfg, &http.Client{Timeout: 10 * time.Second})
}

// ProvideSignInRevoker provides the exchange and revocation of Apple and
// Google tokens (BR-ACC-05).
func ProvideSignInRevoker(cfg config.AuthConfig) (application.SignInRevoker, error) {
	revoker, err := identity.NewRevoker(cfg, &http.Client{Timeout: 10 * time.Second}, time.Now)
	if err != nil {
		return nil, fmt.Errorf("failed to create the sign-in revoker: %w", err)
	}
	return revoker, nil
}

// ProvideUserRepository provides the user repository, which encrypts the
// providers' tokens it stores with AUTH_TOKEN_ENCRYPTION_KEY.
func ProvideUserRepository(
	cfg config.AuthConfig,
	connector *rdb.Connector,
) (application.UserRepository, error) {

	box, err := secretbox.New(cfg.TokenEncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("failed to read AUTH_TOKEN_ENCRYPTION_KEY: %w", err)
	}
	return repository.NewUserRepository(connector.DB(), box), nil
}

// ProvideSessionRepository provides the session repository.
func ProvideSessionRepository(connector *rdb.Connector) application.SessionRepository {
	return repository.NewSessionRepository(connector.DB())
}

// ProvideAccessTokenIssuer provides the signer and verifier of access JWTs.
func ProvideAccessTokenIssuer(cfg config.AuthConfig) (application.AccessTokenIssuer, error) {
	issuer, err := token.NewJWTIssuer(cfg.JWTSigningKey, cfg.JWTPreviousSigningKey)
	if err != nil {
		return nil, fmt.Errorf("failed to create the access token issuer: %w", err)
	}
	return issuer, nil
}

// ProvideAuthenticator provides the sign-in use case.
func ProvideAuthenticator(
	cfg config.AuthConfig,
	verifier application.IdentityVerifier,
	users application.UserRepository,
	sessions application.SessionRepository,
	issuer application.AccessTokenIssuer,
	revoker application.SignInRevoker,
	log *slog.Logger,
) application.Authenticator {

	policy := application.AuthPolicy{
		SessionTTL:        cfg.SessionTTL,
		AccessTokenTTL:    cfg.AccessTokenTTL,
		RefreshReuseGrace: cfg.RefreshReuseGrace,
	}
	return application.NewAuthenticator(verifier, users, sessions, issuer, revoker, policy, time.Now, log)
}

// ProvideAccountDeleter provides the account deletion use case (BR-ACC-05).
func ProvideAccountDeleter(
	users application.UserRepository,
	revoker application.SignInRevoker,
	log *slog.Logger,
) application.AccountDeleter {

	return application.NewAccountDeleter(users, revoker, log)
}

// ProvideCategorySetRepository provides the default category set repository.
func ProvideCategorySetRepository(connector *rdb.Connector) application.CategorySetRepository {
	return repository.NewCategorySetRepository(connector.DB())
}

// ProvideCategorySetLister provides the default category set use case.
func ProvideCategorySetLister(sets application.CategorySetRepository) application.CategorySetLister {
	return application.NewCategorySetLister(sets)
}

// ProvideSyncRepository provides the synced records repository.
func ProvideSyncRepository(connector *rdb.Connector) application.SyncRepository {
	return repository.NewSyncRepository(connector.DB())
}

// ProvideSyncer provides the sync use case.
func ProvideSyncer(records application.SyncRepository) application.Syncer {
	return application.NewSyncer(records, time.Now)
}

// ProvideAPIController provides the API controller.
func ProvideAPIController(
	healthChecker application.HealthChecker,
	auth application.Authenticator,
	accounts application.AccountDeleter,
	categorySets application.CategorySetLister,
	sync application.Syncer,
	log *slog.Logger,
) *controller.APIController {

	return controller.NewAPIController(&controller.APIControllerInput{
		HealthChecker: healthChecker,
		Auth:          auth,
		Accounts:      accounts,
		CategorySets:  categorySets,
		Sync:          sync,
		Logger:        log,
	})
}

// ProvideRouter provides a configured router.
func ProvideRouter(
	cfg config.ServerConfig,
	log *slog.Logger,
	apiController *controller.APIController,
	auth application.Authenticator,
) *router.Router {

	return router.New(cfg, log, apiController, auth)
}

// ProvideApp assembles the application components.
func ProvideApp(r *router.Router, log *slog.Logger) *App {
	return &App{Router: r, Logger: log}
}
