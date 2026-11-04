package rdb

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/schema"

	"github.com/totokunaga/lumei/backend/internal/config"
)

// errDriver stands in for any error the database driver reports.
var errDriver = errors.New("driver boom")

// fakeDriver is a DBDriver whose connections go to sqlmock.
type fakeDriver struct {
	db      *sql.DB
	openErr error
}

// Open returns the sqlmock connection, or openErr.
func (d *fakeDriver) Open(string) (*sql.DB, error) {
	if d.openErr != nil {
		return nil, d.openErr
	}
	return d.db, nil
}

// Dialect returns the PostgreSQL dialect.
func (*fakeDriver) Dialect() schema.Dialect { return pgdialect.New() }

// DriverName returns "fake".
func (*fakeDriver) DriverName() string { return "fake" }

// testConnectorInput is a case of a Connector method.
type testConnectorInput struct {
	name string
	// openErr makes the driver fail to open a connection.
	openErr error
	// setupMocks sets the pings and close the connection expects.
	setupMocks func(mock sqlmock.Sqlmock)
	// act calls the Connector methods under test.
	act            func(t *testing.T, ctx context.Context, c *Connector) error
	expectedErr    error
	expectedErrMsg string
}

// runConnectorTestCases builds a Connector on a fresh sqlmock connection for
// each case, in parallel, runs act, and checks its error and that every
// expected database call happened.
func runConnectorTestCases(t *testing.T, tests []testConnectorInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
			require.NoError(t, err)
			if tt.setupMocks != nil {
				tt.setupMocks(mock)
			}

			// sqlmock serves one connection, so the pool must keep it idle
			// between calls instead of closing it.
			cfg := config.RDBConfig{MaxOpenConns: 1, MaxIdleConns: 1}
			c := NewConnector(&fakeDriver{db: db, openErr: tt.openErr}, cfg)
			err = tt.act(t, t.Context(), c)

			switch {
			case tt.expectedErr != nil:
				require.ErrorIs(t, err, tt.expectedErr)
			case tt.expectedErrMsg != "":
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedErrMsg)
			default:
				require.NoError(t, err)
			}
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
