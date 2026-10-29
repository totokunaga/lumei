// Package main is the entry point for the API server.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/gin-gonic/gin"

	"github.com/totokunaga/lumei/backend/internal/di"
)

func main() {
	// os.Exit is confined to main so it runs only after run's defers (cleanup,
	// signal stop) have unwound. Calling it inside run would skip them, leaving
	// the database connection unclosed.
	if err := run(); err != nil {
		slog.Error("server exited with error", "error", err)
		os.Exit(1)
	}
}

// run builds and runs the application, returning an error instead of exiting so
// that deferred cleanup always executes before the process terminates.
func run() error {
	// Set the gin mode once, here at the single startup site, before
	// InitializeApp builds the engine via gin.New(). gin.SetMode mutates a
	// package-level global, so it must not live in a constructor that tests
	// and production both invoke. GIN_MODE is read directly from the
	// environment (not via config) because the mode must be set before
	// di.InitializeApp loads the configuration. An unset GIN_MODE defaults to
	// release.
	mode := os.Getenv(gin.EnvGinMode)
	if mode == "" {
		mode = gin.ReleaseMode
	}
	gin.SetMode(mode)

	app, cleanup, err := di.InitializeApp()
	if err != nil {
		return fmt.Errorf("failed to initialize application: %w", err)
	}
	defer cleanup()

	logger := app.Logger

	// Install the configured logger as the slog default once, here at the single
	// startup site, so package-level slog calls (e.g. the slog.Error in main)
	// share the same handler. This global side effect is kept out of the logger
	// factory so per-test di.InitializeApp calls never race on the default.
	slog.SetDefault(logger)

	// Cancel the context when a termination signal is received.
	ctx, stop := signal.NotifyContext(
		context.Background(),
		syscall.SIGTERM, syscall.SIGINT,
	)
	defer stop()

	if err := app.Router.Run(ctx); err != nil {
		return err
	}

	logger.Info("application shutdown complete")
	return nil
}
