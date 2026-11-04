package rdb

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
)

func TestConnector(t *testing.T) {
	t.Parallel()

	tests := []testConnectorInput{
		{
			name: "opens, pings, and closes",
			setupMocks: func(mock sqlmock.Sqlmock) {
				mock.ExpectPing()
				mock.ExpectPing()
				mock.ExpectClose()
			},
			act: func(t *testing.T, ctx context.Context, c *Connector) error {
				t.Helper()
				if err := c.Open(ctx); err != nil {
					return err
				}
				assert.NotNil(t, c.DB())
				assert.Equal(t, "fake", c.DriverName())
				if err := c.Ping(ctx); err != nil {
					return err
				}
				return c.Close()
			},
		},
		{
			name:       "refuses to open twice",
			setupMocks: func(mock sqlmock.Sqlmock) { mock.ExpectPing() },
			act: func(_ *testing.T, ctx context.Context, c *Connector) error {
				if err := c.Open(ctx); err != nil {
					return err
				}
				return c.Open(ctx)
			},
			expectedErrMsg: "connector already opened",
		},
		{
			name:    "fails to open when the driver does",
			openErr: errDriver,
			act: func(_ *testing.T, ctx context.Context, c *Connector) error {
				return c.Open(ctx)
			},
			expectedErr:    errDriver,
			expectedErrMsg: "failed to open database connection",
		},
		{
			name: "fails to open and closes the connection when the first ping fails",
			setupMocks: func(mock sqlmock.Sqlmock) {
				mock.ExpectPing().WillReturnError(errDriver)
				mock.ExpectClose()
			},
			act: func(t *testing.T, ctx context.Context, c *Connector) error {
				t.Helper()
				err := c.Open(ctx)
				assert.Nil(t, c.DB())
				return err
			},
			expectedErr: errDriver,
		},
		{
			name: "reports a failed ping on an open connection",
			setupMocks: func(mock sqlmock.Sqlmock) {
				mock.ExpectPing()
				mock.ExpectPing().WillReturnError(errDriver)
			},
			act: func(_ *testing.T, ctx context.Context, c *Connector) error {
				if err := c.Open(ctx); err != nil {
					return err
				}
				return c.Ping(ctx)
			},
			expectedErr: errDriver,
		},
		{
			name: "reports a failed close",
			setupMocks: func(mock sqlmock.Sqlmock) {
				mock.ExpectPing()
				mock.ExpectClose().WillReturnError(errDriver)
			},
			act: func(_ *testing.T, ctx context.Context, c *Connector) error {
				if err := c.Open(ctx); err != nil {
					return err
				}
				return c.Close()
			},
			expectedErr: errDriver,
		},
		{
			name:        "refuses to ping before opening",
			act:         func(_ *testing.T, ctx context.Context, c *Connector) error { return c.Ping(ctx) },
			expectedErr: ErrNotOpened,
		},
		{
			name:        "refuses to close before opening",
			act:         func(_ *testing.T, _ context.Context, c *Connector) error { return c.Close() },
			expectedErr: ErrNotOpened,
		},
		{
			name: "reports empty stats before opening",
			act: func(t *testing.T, _ context.Context, c *Connector) error {
				t.Helper()
				assert.Equal(t, sql.DBStats{}, c.Stats())
				return nil
			},
		},
	}

	runConnectorTestCases(t, tests)
}
