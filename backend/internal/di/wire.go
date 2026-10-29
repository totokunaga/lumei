//go:build wireinject

package di

import (
	"github.com/google/wire"
)

// InitializeApp creates a fully configured application with all dependencies
// injected. It returns the App and a cleanup function to be called on shutdown.
func InitializeApp() (*App, func(), error) {
	wire.Build(
		ProvideConfig,
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
	return nil, nil, nil
}
