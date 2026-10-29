package router

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"

	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// healthProbes matches the health probe routes, whose successful responses the
// Logging middleware omits.
var healthProbes = skipPaths(
	[2]string{http.MethodGet, "/health"},
	[2]string{http.MethodGet, "/health/full"},
)

// Router wraps the gin engine with HTTP server lifecycle management.
type Router struct {
	engine     *gin.Engine
	cfg        config.ServerConfig
	logger     *slog.Logger
	controller generated.ServerInterface
	setupOnce  sync.Once
}

// New creates a new Router with the given configuration, logger, and controller.
func New(
	cfg config.ServerConfig,
	log *slog.Logger,
	controller generated.ServerInterface,
) *Router {

	// The ALB sets X-Forwarded-For. Until its address range is configured here,
	// trust no proxy so a caller cannot choose the client IP that gets logged.
	engine := gin.New()
	_ = engine.SetTrustedProxies(nil)

	return &Router{
		engine:     engine,
		cfg:        cfg,
		logger:     log,
		controller: controller,
	}
}

// setup registers middlewares and routes. It is idempotent so that Handler can
// be called from tests without double-registering when Run also runs.
func (r *Router) setup() {
	r.setupOnce.Do(func() {
		r.engine.Use(
			// RequestID runs first so every log line below carries the ID.
			RequestID(),
			Logging(r.logger, healthProbes),
			// Recovery runs inside Logging so a recovered panic's 500 is logged.
			Recovery(r.logger),
		)

		generated.RegisterHandlers(r.engine, r.controller)
	})
}

// Handler returns the fully configured gin engine with middlewares and routes
// registered. It lets integration tests exercise the production wiring without
// binding a TCP listener.
func (r *Router) Handler() http.Handler {
	r.setup()
	return r.engine
}

// Run starts the server and blocks until the context is cancelled or the
// server fails. On cancellation it performs a graceful shutdown.
func (r *Router) Run(ctx context.Context) error {
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", r.cfg.Port),
		Handler:      r.engine,
		ReadTimeout:  r.cfg.ReadTimeout,
		WriteTimeout: r.cfg.WriteTimeout,
		IdleTimeout:  r.cfg.IdleTimeout,
	}

	// setup wires the Logging middleware, which reads the per-request context;
	// there is no context to inherit at wiring time.
	//nolint:contextcheck // see comment above.
	r.setup()

	serverErrors := make(chan error, 1)
	go func() {
		r.logger.Info("starting server", "port", r.cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrors <- err
		}
	}()

	select {
	case err := <-serverErrors:
		return fmt.Errorf("server error: %w", err)

	case <-ctx.Done():
		r.logger.Info("context cancelled, shutting down server")

		//nolint:contextcheck // gracefulShutdown derives a fresh background context, see below.
		return r.gracefulShutdown(srv)
	}
}

// gracefulShutdown attempts an orderly shutdown, falling back to a forced close
// if the shutdown deadline is exceeded.
func (r *Router) gracefulShutdown(srv *http.Server) error {
	// The parent ctx is already cancelled, so a fresh context bounds the
	// shutdown instead.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), r.cfg.ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		if closeErr := srv.Close(); closeErr != nil {
			return fmt.Errorf("failed to close server: %w", closeErr)
		}
		return fmt.Errorf("graceful shutdown failed: %w", err)
	}

	r.logger.Info("server stopped gracefully")
	return nil
}
