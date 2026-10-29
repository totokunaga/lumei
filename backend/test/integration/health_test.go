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

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb/driver"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

const requestIDHeader = "X-Request-Id"

// response is what a test inspects after a request.
type response struct {
	status int
	header http.Header
	body   []byte
}

// do sends a request with the given headers and returns the response.
func do(t *testing.T, ts *TestServer, method, path string, headers map[string]string) response {
	t.Helper()

	req, err := http.NewRequestWithContext(t.Context(), method, ts.BaseURL+path, http.NoBody)
	require.NoError(t, err)
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := ts.Client().Do(req)
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

// useDisposableDatabase creates an empty database and points the server built
// next at it, so a test can drop it while the server runs. It returns the
// function that drops it.
func useDisposableDatabase(t *testing.T) (drop func()) {
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

	// FORCE terminates the server's open connections, and reconnecting fails
	// because the database no longer exists.
	drop = func() {
		// Not t.Context(): this also runs from t.Cleanup, after it is canceled.
		query := fmt.Sprintf(`DROP DATABASE IF EXISTS %q WITH (FORCE)`, name)
		_, err := admin.ExecContext(context.Background(), query)
		require.NoError(t, err)
	}
	t.Cleanup(drop)
	return drop
}

// assertUnhealthyDatabase asserts a 503 reporting the database check failed.
func assertUnhealthyDatabase(t *testing.T, resp response) {
	t.Helper()

	assert.Equal(t, http.StatusServiceUnavailable, resp.status)
	got := decode[generated.HealthResponse](t, resp.body)
	assert.Equal(t, application.HealthStatusUnhealthy, got.Status)

	database, ok := got.Checks["database"]
	require.True(t, ok, "the database check is reported")
	assert.Equal(t, application.HealthStatusUnhealthy, database.Status)
	assert.True(t, database.Critical)
	assert.Nil(t, database.Details, "a failing check reports no details")
}

func TestGetHealth(t *testing.T) {
	t.Run("200 with a static status", func(t *testing.T) {
		ts := newTestServer(t)

		resp := do(t, ts, http.MethodGet, "/health", nil)

		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, generated.BasicHealthResponse{Status: "ok"},
			decode[generated.BasicHealthResponse](t, resp.body))
		assert.NotEmpty(t, resp.header.Get(requestIDHeader), "a request ID is generated")
	})

	t.Run("echoes the caller's request ID", func(t *testing.T) {
		ts := newTestServer(t)

		resp := do(t, ts, http.MethodGet, "/health", map[string]string{requestIDHeader: "req-123"})

		assert.Equal(t, http.StatusOK, resp.status)
		assert.Equal(t, "req-123", resp.header.Get(requestIDHeader))
	})

	t.Run("404 for an unsupported method", func(t *testing.T) {
		ts := newTestServer(t)

		resp := do(t, ts, http.MethodPost, "/health", nil)

		assert.Equal(t, http.StatusNotFound, resp.status)
	})
}

func TestGetHealthFull(t *testing.T) {
	t.Run("200 with the database healthy", func(t *testing.T) {
		ts := newTestServer(t)

		resp := do(t, ts, http.MethodGet, "/health/full", nil)

		assert.Equal(t, http.StatusOK, resp.status)
		got := decode[generated.HealthResponse](t, resp.body)
		assert.Equal(t, application.HealthStatusHealthy, got.Status)

		database, ok := got.Checks["database"]
		require.True(t, ok, "the database check is reported")
		assert.Equal(t, application.HealthStatusHealthy, database.Status)
		assert.True(t, database.Critical)
		assert.False(t, database.Timestamp.IsZero())
		require.NotNil(t, database.Details)
		assert.Equal(t, "postgres", (*database.Details)["driver"])
		for _, key := range []string{
			"open_connections", "in_use", "idle", "wait_count", "max_idle_closed", "max_lifetime_closed",
		} {
			assert.Contains(t, *database.Details, key)
		}
	})

	t.Run("503 when the database goes away after startup", func(t *testing.T) {
		drop := useDisposableDatabase(t)
		ts := newTestServer(t)
		drop()

		assertUnhealthyDatabase(t, do(t, ts, http.MethodGet, "/health/full", nil))
	})

	t.Run("503 when the database check outlives the timeout", func(t *testing.T) {
		t.Setenv("HEALTH_CHECK_TIMEOUT", "1ns")
		ts := newTestServer(t)

		assertUnhealthyDatabase(t, do(t, ts, http.MethodGet, "/health/full", nil))
	})
}
