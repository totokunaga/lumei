// Package config loads and exposes application configuration.
//
// Configuration is read from environment variables using github.com/caarlos0/env.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/caarlos0/env/v11"
)

// Config holds all configuration for the application.
// It is loaded once at startup and passed via dependency injection.
type Config struct {
	Server ServerConfig
	RDB    RDBConfig
	Log    LogConfig
}

// ServerConfig holds HTTP server configuration.
type ServerConfig struct {
	Port            string        `env:"SERVER_PORT" envDefault:"8080"`
	ReadTimeout     time.Duration `env:"SERVER_READ_TIMEOUT" envDefault:"10s"`
	WriteTimeout    time.Duration `env:"SERVER_WRITE_TIMEOUT" envDefault:"10s"`
	IdleTimeout     time.Duration `env:"SERVER_IDLE_TIMEOUT" envDefault:"60s"`
	ShutdownTimeout time.Duration `env:"SERVER_SHUTDOWN_TIMEOUT" envDefault:"15s"`

	// HealthCheckTimeout bounds every check of GET /health/full. The checks run
	// concurrently, so it is also the bound on the whole response.
	HealthCheckTimeout time.Duration `env:"HEALTH_CHECK_TIMEOUT" envDefault:"5s"`
}

// RDBConfig holds relational database configuration.
type RDBConfig struct {
	Host string `env:"RDB_HOST" envDefault:"localhost"`
	Port int    `env:"RDB_PORT" envDefault:"5432"`
	// User and Password have no envDefault, so no credential is embedded in the
	// binary and an unset variable is an error. See Validate.
	User string `env:"RDB_USER"`
	//nolint:gosec // G117: env-sourced credential; RDBConfig is never serialized.
	Password string `env:"RDB_PASSWORD"`
	Name     string `env:"RDB_NAME" envDefault:"lumei"`
	SSLMode  string `env:"RDB_SSL_MODE" envDefault:"require"`
	// SSLRootCert is the path to a PEM CA bundle used to verify the server's
	// certificate under the verify-ca/verify-full SSL modes. RDS chains to a
	// private Amazon root, so a deployed task points this at the RDS bundle.
	// Empty for local/CI, where disable/require need no root of trust.
	SSLRootCert string `env:"RDB_SSL_ROOT_CERT"`

	MaxOpenConns     int           `env:"RDB_MAX_OPEN_CONNS" envDefault:"25"`
	MaxIdleConns     int           `env:"RDB_MAX_IDLE_CONNS" envDefault:"5"`
	ConnMaxLifetime  time.Duration `env:"RDB_CONN_MAX_LIFETIME" envDefault:"1h"`
	ConnMaxIdleTime  time.Duration `env:"RDB_CONN_MAX_IDLE_TIME" envDefault:"10m"`
	StatementTimeout time.Duration `env:"RDB_STATEMENT_TIMEOUT" envDefault:"10s"`

	// ConnectTimeout bounds the initial connect and ping at startup, so an
	// unreachable database fails the start fast.
	ConnectTimeout time.Duration `env:"RDB_CONNECT_TIMEOUT" envDefault:"5s"`
}

// Validate rejects a database identity the environment did not supply.
func (c RDBConfig) Validate() error {
	if c.User == "" {
		return errors.New("RDB_USER must not be empty")
	}
	if c.Password == "" {
		return errors.New("RDB_PASSWORD must not be empty")
	}
	return nil
}

// DSN returns the PostgreSQL DSN string.
func (c RDBConfig) DSN() string {
	u := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(c.User, c.Password),
		Host:   fmt.Sprintf("%s:%d", c.Host, c.Port),
		Path:   "/" + c.Name,
	}
	q := url.Values{}
	q.Set("sslmode", c.SSLMode)
	if c.StatementTimeout > 0 {
		q.Set("statement_timeout", postgresDuration(c.StatementTimeout))
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// postgresDuration renders a duration in milliseconds, a unit PostgreSQL
// accepts. time.Duration.String would produce values like "1m30s", which it
// rejects.
func postgresDuration(d time.Duration) string {
	milliseconds := d / time.Millisecond
	if d > 0 && d%time.Millisecond != 0 {
		milliseconds++
	}
	return strconv.FormatInt(int64(milliseconds), 10) + "ms"
}

// LogConfig holds logger configuration.
type LogConfig struct {
	Level       string `env:"LOG_LEVEL" envDefault:"info"`
	Format      string `env:"LOG_FORMAT" envDefault:"json"`
	AddSource   bool   `env:"LOG_ADD_SOURCE" envDefault:"false"`
	ServiceName string `env:"LOG_SERVICE_NAME" envDefault:"lumei-api"`
}

// Load reads the environment variables used by the API server and returns a
// validated Config.
func Load() (Config, error) {
	cfg, err := env.ParseAs[Config]()
	if err != nil {
		return Config{}, fmt.Errorf("failed to parse config from env: %w", err)
	}
	if err := cfg.RDB.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// MigrateConfig holds configuration for the database migration CLI. It reuses
// the server's RDB connection parameters.
type MigrateConfig struct {
	RDB RDBConfig

	// MigrationsPath is the directory holding the .up.sql/.down.sql files.
	MigrationsPath string `env:"MIGRATIONS_PATH" envDefault:"./migration"`
	// StatementTimeout bounds how long a single migration statement may run.
	StatementTimeout time.Duration `env:"MIGRATION_STATEMENT_TIMEOUT" envDefault:"60s"`
}

// LoadMigrate reads the environment variables used by the migration CLI and
// returns a validated MigrateConfig.
func LoadMigrate() (MigrateConfig, error) {
	cfg, err := env.ParseAs[MigrateConfig]()
	if err != nil {
		return MigrateConfig{}, fmt.Errorf("failed to parse migrate config from env: %w", err)
	}
	if err := cfg.RDB.Validate(); err != nil {
		return MigrateConfig{}, err
	}
	// Migrations can run longer than API queries, so the session-level timeout
	// follows the migration timeout instead of the API default.
	cfg.RDB.StatementTimeout = cfg.StatementTimeout
	return cfg, nil
}
