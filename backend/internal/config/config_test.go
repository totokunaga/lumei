package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// validAuthConfig returns an AuthConfig that passes Validate, with the
// defaults from the env tags.
func validAuthConfig() AuthConfig {
	return AuthConfig{
		SessionTTL:        2160 * time.Hour,
		AccessTokenTTL:    15 * time.Minute,
		RefreshReuseGrace: time.Minute,
		JWTSigningKey:     "-----BEGIN PRIVATE KEY-----",
	}
}

// withAuth returns a valid AuthConfig after applying change to it.
func withAuth(change func(*AuthConfig)) AuthConfig {
	cfg := validAuthConfig()
	change(&cfg)
	return cfg
}

func TestAuthConfigValidate(t *testing.T) {
	t.Parallel()

	tests := []testValidateInput{
		{
			name: "accepts the defaults with a signing key",
			cfg:  validAuthConfig(),
		},
		{
			name: "accepts no reuse grace, so a replaced refresh token never works",
			cfg:  withAuth(func(c *AuthConfig) { c.RefreshReuseGrace = 0 }),
		},
		{
			name:           "rejects a zero session lifetime (BR-ACC-03)",
			cfg:            withAuth(func(c *AuthConfig) { c.SessionTTL = 0 }),
			expectedErrMsg: "AUTH_SESSION_TTL must be positive",
		},
		{
			name:           "rejects a negative access token lifetime",
			cfg:            withAuth(func(c *AuthConfig) { c.AccessTokenTTL = -time.Second }),
			expectedErrMsg: "AUTH_ACCESS_TOKEN_TTL must be positive",
		},
		{
			name:           "rejects a negative reuse grace",
			cfg:            withAuth(func(c *AuthConfig) { c.RefreshReuseGrace = -time.Second }),
			expectedErrMsg: "AUTH_REFRESH_REUSE_GRACE must not be negative",
		},
		{
			name:           "rejects a missing signing key",
			cfg:            withAuth(func(c *AuthConfig) { c.JWTSigningKey = "" }),
			expectedErrMsg: "AUTH_JWT_SIGNING_KEY must not be empty",
		},
	}

	runValidateTestCases(t, tests)
}

func TestRDBConfigValidate(t *testing.T) {
	t.Parallel()

	tests := []testValidateInput{
		{
			name: "accepts a user and password",
			cfg:  RDBConfig{User: "lumei", Password: "secret"},
		},
		{
			name:           "rejects a missing user",
			cfg:            RDBConfig{Password: "secret"},
			expectedErrMsg: "RDB_USER must not be empty",
		},
		{
			name:           "rejects a missing password",
			cfg:            RDBConfig{User: "lumei"},
			expectedErrMsg: "RDB_PASSWORD must not be empty",
		},
	}

	runValidateTestCases(t, tests)
}

func TestLoad(t *testing.T) {
	t.Parallel()

	tests := []testLoadInput[Config]{
		{
			name:    "reads the environment over the defaults",
			environ: environWith(map[string]string{"SERVER_PORT": "9090", "AUTH_APPLE_CLIENT_IDS": "a,b"}),
			assertFunc: func(t *testing.T, cfg Config) {
				t.Helper()
				assert.Equal(t, "9090", cfg.Server.Port)
				assert.Equal(t, []string{"a", "b"}, cfg.Auth.AppleClientIDs)
				assert.Equal(t, 15*time.Minute, cfg.Auth.AccessTokenTTL)
				assert.Equal(t,
					"postgres://lumei:secret@localhost:5432/lumei?sslmode=require&statement_timeout=10000ms",
					cfg.RDB.DSN())
			},
		},
		{
			name:    "rounds a statement timeout up to whole milliseconds",
			environ: environWith(map[string]string{"RDB_STATEMENT_TIMEOUT": "1500us"}),
			assertFunc: func(t *testing.T, cfg Config) {
				t.Helper()
				assert.Contains(t, cfg.RDB.DSN(), "statement_timeout=2ms")
			},
		},
		{
			name:    "leaves the statement timeout out of the DSN when it is zero",
			environ: environWith(map[string]string{"RDB_STATEMENT_TIMEOUT": "0s"}),
			assertFunc: func(t *testing.T, cfg Config) {
				t.Helper()
				assert.NotContains(t, cfg.RDB.DSN(), "statement_timeout")
			},
		},
		{
			name:           "fails on a value of the wrong type",
			environ:        environWith(map[string]string{"AUTH_SESSION_TTL": "forever"}),
			expectedErrMsg: "failed to parse config from env",
		},
		{
			name:           "fails without database credentials",
			environ:        environWith(map[string]string{"RDB_PASSWORD": ""}),
			expectedErrMsg: "RDB_PASSWORD must not be empty",
		},
		{
			name:           "fails without a JWT signing key",
			environ:        environWith(map[string]string{"AUTH_JWT_SIGNING_KEY": ""}),
			expectedErrMsg: "AUTH_JWT_SIGNING_KEY must not be empty",
		},
	}

	runLoadTestCases(t, tests, load)
}

func TestLoadMigrate(t *testing.T) {
	t.Parallel()

	tests := []testLoadInput[MigrateConfig]{
		{
			name:    "uses the migration statement timeout for the session",
			environ: environWith(map[string]string{"MIGRATION_STATEMENT_TIMEOUT": "2m"}),
			assertFunc: func(t *testing.T, cfg MigrateConfig) {
				t.Helper()
				assert.Equal(t, "./migration", cfg.MigrationsPath)
				assert.Equal(t, 2*time.Minute, cfg.RDB.StatementTimeout)
			},
		},
		{
			name:           "fails on a value of the wrong type",
			environ:        environWith(map[string]string{"MIGRATION_STATEMENT_TIMEOUT": "soon"}),
			expectedErrMsg: "failed to parse migrate config from env",
		},
		{
			name:           "fails without database credentials",
			environ:        environWith(map[string]string{"RDB_USER": ""}),
			expectedErrMsg: "RDB_USER must not be empty",
		},
	}

	runLoadTestCases(t, tests, loadMigrate)
}
