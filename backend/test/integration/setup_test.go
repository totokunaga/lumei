// Package integration contains end-to-end tests that exercise the API server
// against a real database, through the same wiring used in production.
package integration

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/di"
)

// testRDBEnv is the test database credential. RDB_USER/RDB_PASSWORD have no
// default in config.RDBConfig, so without them config.Load refuses to boot.
// The `test` compose service sets them; these cover a bare `go test`.
var testRDBEnv = map[string]string{
	"RDB_USER":     "postgres",
	"RDB_PASSWORD": "postgres",
}

// setEnvDefaults fills in vars the environment has not set, so a deliberate
// value always wins. It runs from TestMain because a test that called
// t.Parallel() may not use t.Setenv.
func setEnvDefaults(vars map[string]string) {
	for name, value := range vars {
		if _, ok := os.LookupEnv(name); ok {
			continue
		}
		if err := os.Setenv(name, value); err != nil {
			panic(fmt.Sprintf("failed to set %s for the test suite: %v", name, err))
		}
	}
}

// TestMain sets the gin mode once for the whole package. Production sets it in
// cmd/main, so building the app through di.InitializeApp never mutates it.
func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	setEnvDefaults(testRDBEnv)
	os.Exit(m.Run())
}

// TestServer encapsulates a running test server.
type TestServer struct {
	BaseURL string
	client  *http.Client
}

// Client returns the HTTP client for making requests against the test server.
func (ts *TestServer) Client() *http.Client { return ts.client }

// newTestServer builds the application through the production wire graph
// (di.InitializeApp) and serves it over an httptest server, so integration
// tests exercise exactly the dependencies that run in production.
func newTestServer(t *testing.T) *TestServer {
	t.Helper()

	app, cleanup, err := di.InitializeApp()
	require.NoError(t, err, "failed to initialize application")

	server := httptest.NewServer(app.Router.Handler())

	t.Cleanup(func() {
		server.Close()
		cleanup()
	})

	return &TestServer{BaseURL: server.URL, client: server.Client()}
}
