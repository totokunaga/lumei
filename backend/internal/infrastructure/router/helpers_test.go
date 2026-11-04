package router

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

func TestMain(m *testing.M) {
	// Set once before any test starts, since gin.SetMode changes a global.
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

// fakeController answers GET /health with getHealth. Any other operation
// panics, since the embedded interface is nil.
type fakeController struct {
	generated.ServerInterface
	getHealth gin.HandlerFunc
}

// GetHealth calls getHealth.
func (f *fakeController) GetHealth(c *gin.Context) { f.getHealth(c) }

// testMiddlewareInput is a case of the Logging and Recovery middlewares.
type testMiddlewareInput struct {
	name string
	// handler answers GET /test behind the middlewares.
	handler        gin.HandlerFunc
	expectedStatus int
	// assertLog checks what the middlewares logged.
	assertLog func(t *testing.T, log string)
}

// runMiddlewareTestCases sends GET /test through Logging and Recovery, as
// setup chains them, for each case, in parallel, and checks the status and log.
func runMiddlewareTestCases(t *testing.T, tests []testMiddlewareInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var out bytes.Buffer
			log := slog.New(slog.NewJSONHandler(&out, nil))
			engine := gin.New()
			engine.Use(Logging(log, nil), Recovery(log))
			engine.GET("/test", tt.handler)

			rec := httptest.NewRecorder()
			engine.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/test", nil))

			assert.Equal(t, tt.expectedStatus, rec.Code)
			tt.assertLog(t, out.String())
		})
	}
}

// testRunInput is a case of Router.Run.
type testRunInput struct {
	name string
	// configure changes the server config, which listens on a free port.
	configure func(cfg *config.ServerConfig)
	// getHealth answers GET /health.
	getHealth gin.HandlerFunc
	// act drives the running server at baseURL, then cancels ctx with stop,
	// unless the server is expected to fail on its own.
	act            func(t *testing.T, baseURL string, stop context.CancelFunc)
	expectedErrMsg string
}

// runRunTestCases starts a Router for each case, in parallel, lets act drive
// it, and checks the error Run returns.
func runRunTestCases(t *testing.T, tests []testRunInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			cfg := config.ServerConfig{Port: freePort(t), ShutdownTimeout: time.Minute}
			if tt.configure != nil {
				tt.configure(&cfg)
			}
			controller := &fakeController{getHealth: tt.getHealth}
			r := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), controller, nil)

			ctx, stop := context.WithCancel(t.Context())
			defer stop()
			done := make(chan error, 1)
			go func() { done <- r.Run(ctx) }()

			tt.act(t, "http://127.0.0.1:"+cfg.Port, stop)

			err := <-done
			if tt.expectedErrMsg == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.expectedErrMsg)
		})
	}
}

// freePort returns a TCP port nothing listens on right now.
func freePort(t *testing.T) string {
	t.Helper()

	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := l.Addr().(*net.TCPAddr).Port
	require.NoError(t, l.Close())
	return fmt.Sprint(port)
}

// waitUntilServing waits until the server at baseURL answers GET /health.
func waitUntilServing(t *testing.T, baseURL string) {
	t.Helper()

	require.Eventually(t, func() bool {
		res, err := http.Get(baseURL + "/health") //nolint:noctx // a probe with no request to cancel.
		if err != nil {
			return false
		}
		_ = res.Body.Close()
		return res.StatusCode == http.StatusOK
	}, 10*time.Second, 10*time.Millisecond)
}
