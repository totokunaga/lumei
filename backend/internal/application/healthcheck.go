// Package application provides application-level use cases, including the
// health check of every dependency.
package application

import (
	"context"
	"sync"
	"time"
)

const (
	// HealthStatusHealthy represents a passing check, or a service whose checks
	// all pass.
	HealthStatusHealthy = "healthy"
	// HealthStatusUnhealthy represents a failing check, or a service with a
	// failing critical check.
	HealthStatusUnhealthy = "unhealthy"
	// HealthStatusDegraded represents a service whose critical checks pass but
	// whose other checks do not all pass.
	HealthStatusDegraded = "degraded"
)

// HealthDetails holds check-specific diagnostics, such as the database's
// connection-pool counters. A check with nothing to add returns nil.
type HealthDetails map[string]any

// HealthCheck is the port every dependency's health check implements. A new
// dependency is added to GET /health/full by implementing it and registering
// the implementation in DI.
type HealthCheck interface {
	// Name is the key the result is reported under, e.g. "database".
	Name() string
	// Critical reports whether a failure makes the whole service unhealthy
	// (503). A non-critical failure only makes it degraded (200), because it
	// breaks the features that use the dependency rather than the service.
	Critical() bool
	// Check verifies the dependency is reachable and returns its diagnostics.
	Check(ctx context.Context) (HealthDetails, error)
}

// HealthCheckResult represents the result of one HealthCheck.
type HealthCheckResult struct {
	Name         string
	Status       string
	Critical     bool
	Details      HealthDetails
	ResponseTime time.Duration
	Timestamp    time.Time
	// Err is the check failure. It is for logging, not for the response body.
	Err error
}

// HealthReport represents the overall status and every check's result.
type HealthReport struct {
	Status string
	// Checks holds one result per registered check, in registration order.
	Checks []HealthCheckResult
}

// HealthChecker defines the interface for checking every dependency.
type HealthChecker interface {
	Check(ctx context.Context) HealthReport
}

// HealthCheckUsecase implements HealthChecker by running every check
// concurrently under one timeout.
type HealthCheckUsecase struct {
	checks  []HealthCheck
	timeout time.Duration
}

// NewHealthChecker creates a HealthCheckUsecase.
func NewHealthChecker(checks []HealthCheck, timeout time.Duration) *HealthCheckUsecase {
	return &HealthCheckUsecase{checks: checks, timeout: timeout}
}

// Check runs every check concurrently. The service is unhealthy when a critical
// check fails, degraded when only non-critical ones do, and healthy otherwise.
func (h *HealthCheckUsecase) Check(ctx context.Context) HealthReport {
	if h.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, h.timeout)
		defer cancel()
	}

	results := make([]HealthCheckResult, len(h.checks))
	var wg sync.WaitGroup
	for i, check := range h.checks {
		wg.Go(func() {
			start := time.Now()
			details, err := check.Check(ctx)
			status := HealthStatusHealthy
			if err != nil {
				status = HealthStatusUnhealthy
			}
			results[i] = HealthCheckResult{
				Name:         check.Name(),
				Status:       status,
				Critical:     check.Critical(),
				Details:      details,
				ResponseTime: time.Since(start),
				Timestamp:    start,
				Err:          err,
			}
		})
	}
	wg.Wait()

	return HealthReport{Status: overallStatus(results), Checks: results}
}

func overallStatus(results []HealthCheckResult) string {
	status := HealthStatusHealthy
	for _, r := range results {
		if r.Err == nil {
			continue
		}
		if r.Critical {
			return HealthStatusUnhealthy
		}
		status = HealthStatusDegraded
	}
	return status
}
