// Package rdb provides relational database connection management using bun ORM.
package rdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/schema"

	"github.com/totokunaga/lumei/backend/internal/config"
)

// ErrNotOpened is returned when an operation requires an open connection.
var ErrNotOpened = errors.New("connector not opened")

// DBDriver is an interface for database-agnostic driver injection.
// Implementations provide the underlying sql.DB and bun dialect.
type DBDriver interface {
	// Open opens a database connection and returns the underlying sql.DB.
	Open(dsn string) (*sql.DB, error)

	// Dialect returns the bun dialect for the specific database.
	Dialect() schema.Dialect

	// DriverName returns the name of the driver (e.g., "postgres").
	DriverName() string
}

// Connector manages a database connection using bun ORM.
type Connector struct {
	db     *bun.DB
	driver DBDriver
	cfg    config.RDBConfig
}

// NewConnector creates a new Connector with the given driver and configuration.
func NewConnector(driver DBDriver, cfg config.RDBConfig) *Connector {
	return &Connector{
		driver: driver,
		cfg:    cfg,
	}
}

// Open establishes a database connection using the configured DSN and
// configures the connection pool.
func (c *Connector) Open(ctx context.Context) error {
	if c.db != nil {
		return errors.New("connector already opened")
	}

	sqlDB, err := c.driver.Open(c.cfg.DSN())
	if err != nil {
		return fmt.Errorf("failed to open database connection: %w", err)
	}

	sqlDB.SetMaxOpenConns(c.cfg.MaxOpenConns)
	sqlDB.SetMaxIdleConns(c.cfg.MaxIdleConns)
	sqlDB.SetConnMaxLifetime(c.cfg.ConnMaxLifetime)
	sqlDB.SetConnMaxIdleTime(c.cfg.ConnMaxIdleTime)

	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return fmt.Errorf("failed to ping database: %w", err)
	}

	c.db = bun.NewDB(sqlDB, c.driver.Dialect())
	return nil
}

// Close closes the database connection.
func (c *Connector) Close() error {
	if c.db == nil {
		return ErrNotOpened
	}
	if err := c.db.Close(); err != nil {
		return fmt.Errorf("failed to close database connection: %w", err)
	}
	c.db = nil
	return nil
}

// Ping verifies the database connection is alive.
func (c *Connector) Ping(ctx context.Context) error {
	if c.db == nil {
		return ErrNotOpened
	}
	if err := c.db.PingContext(ctx); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}
	return nil
}

// Stats returns database statistics including connection pool information.
func (c *Connector) Stats() sql.DBStats {
	if c.db == nil {
		return sql.DBStats{}
	}
	return c.db.Stats()
}

// DriverName returns the name of the underlying driver.
func (c *Connector) DriverName() string {
	return c.driver.DriverName()
}

// DB returns the underlying bun.DB instance for query operations.
func (c *Connector) DB() *bun.DB {
	return c.db
}
