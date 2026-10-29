package integration

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// assertHealthyDatabase asserts the body reports a healthy database with its
// driver and connection-pool counters.
func assertHealthyDatabase(t *testing.T, resp response) {
	t.Helper()

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
}

// assertUnhealthyDatabase asserts the body reports the database check failed.
func assertUnhealthyDatabase(t *testing.T, resp response) {
	t.Helper()

	got := decode[generated.HealthResponse](t, resp.body)
	assert.Equal(t, application.HealthStatusUnhealthy, got.Status)

	database, ok := got.Checks["database"]
	require.True(t, ok, "the database check is reported")
	assert.Equal(t, application.HealthStatusUnhealthy, database.Status)
	assert.True(t, database.Critical)
	assert.Nil(t, database.Details, "a failing check reports no details")
}

func TestGetHealth(t *testing.T) {
	tests := []testIntegrationInput{
		{
			name:           "200 with a static status",
			req:            req{method: http.MethodGet, path: "/health"},
			expectedStatus: http.StatusOK,
			assertFunc: assertAll(
				assertBody(generated.BasicHealthResponse{Status: "ok"}),
				assertHeader(requestIDHeader, ""),
			),
		},
		{
			name: "200 echoing the caller's request ID",
			req: req{
				method:  http.MethodGet,
				path:    "/health",
				headers: map[string]string{requestIDHeader: "req-123"},
			},
			expectedStatus: http.StatusOK,
			assertFunc:     assertHeader(requestIDHeader, "req-123"),
		},
		{
			name:           "404 for an unsupported method",
			req:            req{method: http.MethodPost, path: "/health"},
			expectedStatus: http.StatusNotFound,
		},
	}

	runIntegrationTestCases(t, tests)
}

func TestGetHealthFull(t *testing.T) {
	tests := []testIntegrationInput{
		{
			name:           "200 with the database healthy",
			req:            req{method: http.MethodGet, path: "/health/full"},
			expectedStatus: http.StatusOK,
			assertFunc:     assertHealthyDatabase,
		},
		{
			name:           "503 when the database goes away after startup",
			req:            req{method: http.MethodGet, path: "/health/full"},
			setupFunc:      useDisposableDatabase,
			expectedStatus: http.StatusServiceUnavailable,
			assertFunc:     assertUnhealthyDatabase,
		},
		{
			name:           "503 when the database check outlives the timeout",
			req:            req{method: http.MethodGet, path: "/health/full"},
			env:            map[string]string{"HEALTH_CHECK_TIMEOUT": "1ns"},
			expectedStatus: http.StatusServiceUnavailable,
			assertFunc:     assertUnhealthyDatabase,
		},
	}

	runIntegrationTestCases(t, tests)
}
