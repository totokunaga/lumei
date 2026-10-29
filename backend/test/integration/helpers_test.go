package integration

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb/driver"
)

const requestIDHeader = "X-Request-Id"

type req struct {
	method  string
	path    string
	headers map[string]string
}

// response is what a test inspects after a request.
type response struct {
	status int
	header http.Header
	body   []byte
}

type testIntegrationInput struct {
	name string
	req  req

	// env is set (via t.Setenv) before the server is built.
	env map[string]string

	// setupFunc runs before the server is built. The returned function, if
	// any, runs after the server is built and before the request is sent.
	setupFunc func(t *testing.T) (afterStart func())

	expectedStatus int

	// assertFunc asserts the rest of the response (body, headers). The status
	// is already checked against expectedStatus.
	assertFunc func(t *testing.T, resp response)
}

// runIntegrationTestCases builds a fresh server per case through the
// production wiring and sends the case's request to it. Cases do not run in
// parallel because they may set environment variables.
func runIntegrationTestCases(t *testing.T, tests []testIntegrationInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for k, v := range tt.env {
				t.Setenv(k, v)
			}

			var afterStart func()
			if tt.setupFunc != nil {
				afterStart = tt.setupFunc(t)
			}

			ts := newTestServer(t)
			if afterStart != nil {
				afterStart()
			}

			resp := do(t, ts, tt.req)

			assert.Equal(t, tt.expectedStatus, resp.status)
			if tt.assertFunc != nil {
				tt.assertFunc(t, resp)
			}
		})
	}
}

// do sends r to the test server and returns the response.
func do(t *testing.T, ts *TestServer, r req) response {
	t.Helper()

	httpReq, err := http.NewRequestWithContext(t.Context(), r.method, ts.BaseURL+r.path, http.NoBody)
	require.NoError(t, err)
	for k, v := range r.headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := ts.Client().Do(httpReq)
	require.NoError(t, err)
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return response{status: resp.StatusCode, header: resp.Header, body: body}
}

// decode unmarshals a JSON response body into T.
func decode[T any](t *testing.T, body []byte) T {
	t.Helper()

	var v T
	require.NoError(t, json.Unmarshal(body, &v))
	return v
}

// assertBody builds an assertFunc requiring the body to decode to want exactly.
func assertBody[T any](want T) func(t *testing.T, resp response) {
	return func(t *testing.T, resp response) {
		t.Helper()

		assert.Equal(t, want, decode[T](t, resp.body))
	}
}

// assertAll builds an assertFunc running every given assertFunc in order.
func assertAll(fns ...func(t *testing.T, resp response)) func(t *testing.T, resp response) {
	return func(t *testing.T, resp response) {
		t.Helper()

		for _, fn := range fns {
			fn(t, resp)
		}
	}
}

// assertHeader builds an assertFunc requiring the header to equal want, or to
// be present with any value when want is empty.
func assertHeader(key, want string) func(t *testing.T, resp response) {
	return func(t *testing.T, resp response) {
		t.Helper()

		if want == "" {
			assert.NotEmpty(t, resp.header.Get(key), "%s is set", key)
			return
		}
		assert.Equal(t, want, resp.header.Get(key))
	}
}

// useDisposableDatabase is a setupFunc that points the server at a new, empty
// database and drops it once the server has started. Dropping with FORCE
// terminates the server's open connections, and reconnecting fails because the
// database no longer exists.
func useDisposableDatabase(t *testing.T) (afterStart func()) {
	t.Helper()

	cfg, err := config.Load()
	require.NoError(t, err)

	admin, err := driver.NewPostgresDriver(cfg.RDB).Open(cfg.RDB.DSN())
	require.NoError(t, err)
	t.Cleanup(func() { _ = admin.Close() })

	suffix := make([]byte, 6)
	_, err = rand.Read(suffix)
	require.NoError(t, err)
	name := "lumei_disposable_" + hex.EncodeToString(suffix)

	_, err = admin.ExecContext(t.Context(), fmt.Sprintf(`CREATE DATABASE %q`, name))
	require.NoError(t, err)
	t.Setenv("RDB_NAME", name)

	drop := func() {
		// Not t.Context(): this also runs from t.Cleanup, after it is canceled.
		query := fmt.Sprintf(`DROP DATABASE IF EXISTS %q WITH (FORCE)`, name)
		_, err := admin.ExecContext(context.Background(), query)
		require.NoError(t, err)
	}
	t.Cleanup(drop)
	return drop
}
