package controller

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/mock/gomock"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
	"github.com/totokunaga/lumei/backend/internal/mock"
)

// GET /health and the healthy and 503 responses of GET /health/full are
// covered by test/integration. Only the degraded response needs a unit test:
// no production check is non-critical yet.

type healthMocks struct {
	checker *mock.MockHealthChecker
}

func newHealthTestEnv(ctrl *gomock.Controller) (healthMocks, *gin.Engine) {
	m := healthMocks{checker: mock.NewMockHealthChecker(ctrl)}
	api := NewAPIController(&APIControllerInput{
		HealthChecker: m.checker,
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	router := gin.New()
	generated.RegisterHandlers(router, api)
	return m, router
}

func TestGetHealthFull(t *testing.T) {
	t.Parallel()

	timestamp := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

	tests := []testControllerInput[healthMocks]{
		{
			name: "200 when only a non-critical check fails",
			req:  req{method: http.MethodGet, path: "/health/full"},
			setupMocks: func(m healthMocks) {
				m.checker.EXPECT().Check(gomock.Any()).Return(application.HealthReport{
					Status: application.HealthStatusDegraded,
					Checks: []application.HealthCheckResult{
						{
							Name: "database", Status: application.HealthStatusHealthy, Critical: true,
							ResponseTime: 3 * time.Millisecond, Timestamp: timestamp,
						},
						{
							Name: "cache", Status: application.HealthStatusUnhealthy,
							ResponseTime: 5 * time.Millisecond, Timestamp: timestamp,
							Err: errors.New("connection refused"),
						},
					},
				})
			},
			expectedResp: resp{
				status: http.StatusOK,
				body: generated.HealthResponse{
					Status: application.HealthStatusDegraded,
					Checks: map[string]generated.HealthCheckEntry{
						"database": {
							Status: application.HealthStatusHealthy, Critical: true,
							ResponseTimeMs: 3, Timestamp: timestamp,
						},
						"cache": {
							Status:         application.HealthStatusUnhealthy,
							ResponseTimeMs: 5, Timestamp: timestamp,
						},
					},
				},
			},
			parseRespBodyFunc: parseResponseBodyPtr[generated.HealthResponse],
			assertFunc:        assertBody[generated.HealthResponse],
		},
	}

	runControllerTestCases(t, tests, newHealthTestEnv)
}
