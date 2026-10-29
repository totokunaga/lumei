package controller

import (
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// GetHealth is a liveness check confirming the web server is running.
func (*APIController) GetHealth(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, generated.BasicHealthResponse{
		Status: "ok",
	})
}

// GetHealthFull is a readiness check running every registered health check.
// Only a failing critical check answers 503: the others fail individual
// features rather than the whole service, so they report "degraded".
func (a *APIController) GetHealthFull(ctx *gin.Context) {
	reqCtx := ctx.Request.Context()

	report := a.HealthChecker.Check(reqCtx)

	checks := make(map[string]generated.HealthCheckEntry, len(report.Checks))
	for _, c := range report.Checks {
		if c.Err != nil {
			level := slog.LevelWarn
			if c.Critical {
				level = slog.LevelError
			}
			a.Logger.Log(reqCtx, level, "health check failed",
				"check", c.Name, "critical", c.Critical, "error", c.Err)
		}

		entry := generated.HealthCheckEntry{
			Status:         c.Status,
			Critical:       c.Critical,
			ResponseTimeMs: c.ResponseTime.Milliseconds(),
			Timestamp:      c.Timestamp,
		}
		if len(c.Details) > 0 {
			details := map[string]any(c.Details)
			entry.Details = &details
		}
		checks[c.Name] = entry
	}

	status := http.StatusOK
	if report.Status == application.HealthStatusUnhealthy {
		status = http.StatusServiceUnavailable
	}
	ctx.JSON(status, generated.HealthResponse{Status: report.Status, Checks: checks})
}
