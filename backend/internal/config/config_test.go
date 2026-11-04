package config

import (
	"testing"
	"time"
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
