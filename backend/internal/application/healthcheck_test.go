package application_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/mock"
)

// The healthy and unhealthy reports are covered by test/integration. Only the
// degraded report needs a unit test: no production check is non-critical yet.

type healthCheckMocks struct {
	database *mock.MockHealthCheck
	cache    *mock.MockHealthCheck
}

// expectCheck sets the identity a check reports and what its Check returns.
func expectCheck(
	m *mock.MockHealthCheck,
	name string,
	critical bool,
	details application.HealthDetails,
	err error,
) {

	m.EXPECT().Name().Return(name).AnyTimes()
	m.EXPECT().Critical().Return(critical).AnyTimes()
	m.EXPECT().Check(gomock.Any()).Return(details, err)
}

func TestHealthCheckUsecase_Check(t *testing.T) {
	t.Parallel()

	poolDetails := application.HealthDetails{"driver": "postgres", "open_connections": 3}
	errDown := errors.New("connection refused")

	tests := []testUseCaseInput[time.Duration, application.HealthReport, healthCheckMocks]{
		{
			name:  "degraded when only a non-critical check fails",
			input: time.Second,
			expectedOutput: application.HealthReport{
				Status: application.HealthStatusDegraded,
				Checks: []application.HealthCheckResult{
					{
						Name: "database", Status: application.HealthStatusHealthy,
						Critical: true, Details: poolDetails,
					},
					{Name: "cache", Status: application.HealthStatusUnhealthy, Err: errDown},
				},
			},
			setupMocks: func(m healthCheckMocks) {
				expectCheck(m.database, "database", true, poolDetails, nil)
				expectCheck(m.cache, "cache", false, nil, errDown)
			},
			assertFunc: assertHealthReport,
		},
	}

	runUseCaseTestCases(t, tests,
		func(ctrl *gomock.Controller) healthCheckMocks {
			return healthCheckMocks{
				database: mock.NewMockHealthCheck(ctrl),
				cache:    mock.NewMockHealthCheck(ctrl),
			}
		},
		func(
			ctx context.Context,
			m healthCheckMocks,
			timeout time.Duration,
		) (application.HealthReport, error) {

			checks := []application.HealthCheck{m.database, m.cache}
			return application.NewHealthChecker(checks, timeout).Check(ctx), nil
		},
	)
}

// assertHealthReport compares everything but the measured timing fields and
// matches each check's error by identity.
func assertHealthReport(
	t *testing.T,
	output, expected application.HealthReport,
	err error,
	_ string,
) {

	t.Helper()

	require.NoError(t, err)
	assert.Equal(t, expected.Status, output.Status)
	require.Len(t, output.Checks, len(expected.Checks))
	for i, want := range expected.Checks {
		got := output.Checks[i]
		assert.Equal(t, want.Name, got.Name, "results keep registration order")
		assert.Equal(t, want.Status, got.Status)
		assert.Equal(t, want.Critical, got.Critical)
		assert.Equal(t, want.Details, got.Details)
		assert.ErrorIs(t, got.Err, want.Err)
		assert.False(t, got.Timestamp.IsZero(), "every result is timestamped")
	}
}
