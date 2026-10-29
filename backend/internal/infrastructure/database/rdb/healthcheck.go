package rdb

import (
	"context"

	"github.com/totokunaga/lumei/backend/internal/application"
)

var _ application.HealthCheck = (*HealthProbe)(nil)

// HealthProbe adapts the relational database connector to the application
// health-check port.
type HealthProbe struct {
	connector *Connector
}

// NewHealthProbe creates a new relational database health probe.
func NewHealthProbe(connector *Connector) *HealthProbe {
	return &HealthProbe{connector: connector}
}

// Name reports the database under "database".
func (*HealthProbe) Name() string { return "database" }

// Critical is true: no route works without the database.
func (*HealthProbe) Critical() bool { return true }

// Check verifies the already-open database connection is reachable and returns
// the driver and connection-pool counters.
func (h *HealthProbe) Check(ctx context.Context) (application.HealthDetails, error) {
	if err := h.connector.Ping(ctx); err != nil {
		return nil, err
	}

	stats := h.connector.Stats()
	return application.HealthDetails{
		"driver":              h.connector.DriverName(),
		"open_connections":    stats.OpenConnections,
		"in_use":              stats.InUse,
		"idle":                stats.Idle,
		"wait_count":          stats.WaitCount,
		"max_idle_closed":     stats.MaxIdleClosed,
		"max_lifetime_closed": stats.MaxLifetimeClosed,
	}, nil
}
