// Package di wires application dependencies together.
package di

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb/driver"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/logger"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/router"
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

// ProvideAPIController provides the API controller.
func ProvideAPIController(
	healthChecker application.HealthChecker,
	log *slog.Logger,
) *controller.APIController {

	return controller.NewAPIController(&controller.APIControllerInput{
		HealthChecker: healthChecker,
		Logger:        log,
	})
}

// ProvideRouter provides a configured router.
func ProvideRouter(
	cfg config.ServerConfig,
	log *slog.Logger,
	apiController *controller.APIController,
) *router.Router {

	return router.New(cfg, log, apiController)
}

// ProvideApp assembles the application components.
func ProvideApp(r *router.Router, log *slog.Logger) *App {
	return &App{Router: r, Logger: log}
}
