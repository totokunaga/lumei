package router

import (
	"context"
	"errors"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/config"
)

func TestRouterRun(t *testing.T) {
	t.Parallel()

	ok := func(c *gin.Context) { c.Status(http.StatusOK) }

	// A request that is still running when the server shuts down. The handler
	// reports it started, then waits for release; the first probe of
	// waitUntilServing goes through.
	started := make(chan struct{})
	release := make(chan struct{})
	var probed atomic.Bool
	slow := func(c *gin.Context) {
		if probed.CompareAndSwap(false, true) {
			c.Status(http.StatusOK)
			return
		}
		close(started)
		<-release
		c.Status(http.StatusOK)
	}

	tests := []testRunInput{
		{
			name:      "serves until the context is canceled, then shuts down gracefully",
			getHealth: ok,
			act: func(t *testing.T, baseURL string, stop context.CancelFunc) {
				t.Helper()
				waitUntilServing(t, baseURL)
				stop()
			},
		},
		{
			name:      "fails when it can't listen",
			configure: func(cfg *config.ServerConfig) { cfg.Port = "-1" },
			getHealth: ok,
			act:       func(*testing.T, string, context.CancelFunc) {},
			// Nothing cancels the context: Run must return on its own.
			expectedErrMsg: "server error",
		},
		{
			name:      "closes the server when a request outlasts the shutdown timeout",
			configure: func(cfg *config.ServerConfig) { cfg.ShutdownTimeout = time.Nanosecond },
			getHealth: slow,
			act: func(t *testing.T, baseURL string, stop context.CancelFunc) {
				t.Helper()
				waitUntilServing(t, baseURL)
				t.Cleanup(func() { close(release) })
				go func() {
					res, err := http.Get(baseURL + "/health") //nolint:noctx // the server closes it.
					if err == nil {
						_ = res.Body.Close()
					}
				}()
				<-started
				stop()
			},
			expectedErrMsg: "graceful shutdown failed: context deadline exceeded",
		},
	}

	runRunTestCases(t, tests)
}

func TestMiddlewares(t *testing.T) {
	t.Parallel()

	tests := []testMiddlewareInput{
		{
			name: "logs a recovered panic and answers 500",
			handler: func(*gin.Context) {
				panic("handler boom")
			},
			expectedStatus: http.StatusInternalServerError,
			assertLog: func(t *testing.T, log string) {
				t.Helper()
				assert.Contains(t, log, `"msg":"panic recovered","error":"handler boom"`)
				assert.Contains(t, log, `"stack":`)
				assert.Contains(t, log, `"msg":"server error"`)
			},
		},
		{
			name: "logs the handler's private errors with a client error",
			handler: func(c *gin.Context) {
				_ = c.Error(errors.New("bad input detail"))
				c.Status(http.StatusBadRequest)
			},
			expectedStatus: http.StatusBadRequest,
			assertLog: func(t *testing.T, log string) {
				t.Helper()
				assert.Contains(t, log, `"msg":"client error"`)
				assert.Contains(t, log, `"error":"Error #01: bad input detail\n"`)
			},
		},
		{
			name:           "logs a success without errors",
			handler:        func(c *gin.Context) { c.Status(http.StatusNoContent) },
			expectedStatus: http.StatusNoContent,
			assertLog: func(t *testing.T, log string) {
				t.Helper()
				require.Contains(t, log, `"msg":"request completed"`)
				assert.NotContains(t, log, `"error"`)
			},
		},
	}

	runMiddlewareTestCases(t, tests)
}
