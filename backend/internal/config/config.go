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
	Auth   AuthConfig
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
	User     string `env:"RDB_USER"`
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

// AuthConfig holds sign-in and session configuration.
type AuthConfig struct {
	// SessionTTL is how long a session lasts after its last use: each
	// refresh extends it by this much (BR-ACC-03). It is the lifetime of the
	// refresh token.
	SessionTTL time.Duration `env:"AUTH_SESSION_TTL" envDefault:"2160h"`

	// AccessTokenTTL is how long an access JWT is valid. It is also how long
	// a token issued before sign-out keeps working, since access tokens are
	// checked without the database.
	AccessTokenTTL time.Duration `env:"AUTH_ACCESS_TOKEN_TTL" envDefault:"15m"`

	// RefreshReuseGrace is how long a replaced refresh token still works, so
	// a refresh whose response was lost, or two racing refreshes, don't sign
	// the user out. Reusing it later ends the session, as a stolen token
	// would.
	RefreshReuseGrace time.Duration `env:"AUTH_REFRESH_REUSE_GRACE" envDefault:"1m"`

	// JWTSigningKey is the PEM-encoded (PKCS #8) P-256 private key that signs
	// access JWTs with ES256.
	JWTSigningKey string `env:"AUTH_JWT_SIGNING_KEY"`
	// JWTPreviousSigningKey is the key used before the last rotation. Tokens
	// it signed are still accepted until they expire. Empty when not
	// rotating.
	JWTPreviousSigningKey string `env:"AUTH_JWT_PREVIOUS_SIGNING_KEY"`

	// AppleClientIDs are the audiences a Sign in with Apple ID token may be
	// issued for: the iOS bundle ID, and later the Services ID used on
	// Android. Empty disables Apple sign-in.
	AppleClientIDs []string `env:"AUTH_APPLE_CLIENT_IDS" envSeparator:","`
	AppleIssuer    string   `env:"AUTH_APPLE_ISSUER" envDefault:"https://appleid.apple.com"`
	AppleJWKSURL   string   `env:"AUTH_APPLE_JWKS_URL" envDefault:"https://appleid.apple.com/auth/keys"`

	// GoogleClientIDs are the audiences a Google ID token may be issued for:
	// the web client ID the app passes to Google Sign-In. Empty disables
	// Google sign-in.
	GoogleClientIDs []string `env:"AUTH_GOOGLE_CLIENT_IDS" envSeparator:","`
	GoogleIssuer    string   `env:"AUTH_GOOGLE_ISSUER" envDefault:"https://accounts.google.com"`

	// GoogleJWKSURL serves the keys Google signs ID tokens with.
	GoogleJWKSURL string `env:"AUTH_GOOGLE_JWKS_URL" envDefault:"https://www.googleapis.com/oauth2/v3/certs"`

	// DevSignIn enables the "dev" provider, which signs in as any email
	// without proof. Only for local development: never enable it in a
	// deployed environment.
	DevSignIn bool `env:"AUTH_DEV_SIGN_IN" envDefault:"false"`
}

// Validate rejects lifetimes that would end every session at once, and a
// missing signing key.
func (c AuthConfig) Validate() error {
	if c.SessionTTL <= 0 {
		return errors.New("AUTH_SESSION_TTL must be positive")
	}
	if c.AccessTokenTTL <= 0 {
		return errors.New("AUTH_ACCESS_TOKEN_TTL must be positive")
	}
	if c.RefreshReuseGrace < 0 {
		return errors.New("AUTH_REFRESH_REUSE_GRACE must not be negative")
	}
	if c.JWTSigningKey == "" {
		return errors.New("AUTH_JWT_SIGNING_KEY must not be empty")
	}
	return nil
}

// Load reads the environment variables used by the API server and returns a
// validated Config.
func Load() (Config, error) {
	return load(env.Options{})
}

// load is Load reading from opts, so tests can pass their own environment
// instead of changing the process's.
func load(opts env.Options) (Config, error) {
	cfg, err := env.ParseAsWithOptions[Config](opts)
	if err != nil {
		return Config{}, fmt.Errorf("failed to parse config from env: %w", err)
	}
	if err := cfg.RDB.Validate(); err != nil {
		return Config{}, err
	}
	if err := cfg.Auth.Validate(); err != nil {
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
	return loadMigrate(env.Options{})
}

// loadMigrate is LoadMigrate reading from opts, so tests can pass their own
// environment instead of changing the process's.
func loadMigrate(opts env.Options) (MigrateConfig, error) {
	cfg, err := env.ParseAsWithOptions[MigrateConfig](opts)
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
