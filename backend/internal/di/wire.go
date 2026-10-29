//go:build wireinject

package di

import (
	"github.com/google/wire"

	"github.com/totokunaga/lumei/backend/internal/config"
)

// appSet builds the App from a *config.Config. Both injectors share it, so the
// graph tests build is the graph production runs.
var appSet = wire.NewSet(
	ProvideServerConfig,
	ProvideRDBConfig,
	ProvideLogConfig,
	ProvideLogger,
	ProvideDBDriver,
	ProvideConnector,
	ProvideHealthChecks,
	ProvideHealthChecker,
	ProvideAPIController,
	ProvideRouter,
	ProvideApp,
)

// InitializeApp creates a fully configured application with all dependencies
// injected. It returns the App and a cleanup function to be called on shutdown.
func InitializeApp() (*App, func(), error) {
	wire.Build(ProvideConfig, appSet)
	return nil, nil, nil
}

// InitializeAppWithConfig is InitializeApp with the configuration supplied by
// the caller instead of read from the environment. Integration tests use it to
// change settings per case without t.Setenv, so the cases can run in parallel.
func InitializeAppWithConfig(cfg *config.Config) (*App, func(), error) {
	wire.Build(appSet)
	return nil, nil, nil
}
