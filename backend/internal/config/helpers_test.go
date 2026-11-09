package config

import (
	"testing"

	"github.com/caarlos0/env/v11"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testValidateInput is a case of a config's Validate method.
type testValidateInput struct {
	name           string
	cfg            interface{ Validate() error }
	expectedErrMsg string
}

// runValidateTestCases validates each case's config, in parallel, and checks
// the error it returns.
func runValidateTestCases(t *testing.T, tests []testValidateInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			err := tt.cfg.Validate()
			if tt.expectedErrMsg == "" {
				require.NoError(t, err)
				return
			}
			assert.EqualError(t, err, tt.expectedErrMsg)
		})
	}
}

// testLoadInput is a case of loading a config of type T from an environment.
type testLoadInput[T any] struct {
	name string
	// environ is the whole environment the case loads from; the process's own
	// is never read.
	environ        map[string]string
	expectedErrMsg string
	// assertFunc checks the loaded config when loading succeeds.
	assertFunc func(t *testing.T, cfg T)
}

// runLoadTestCases loads each case's environment with load, in parallel, and
// checks the config or the error.
func runLoadTestCases[T any](t *testing.T, tests []testLoadInput[T], load func(env.Options) (T, error)) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			cfg, err := load(env.Options{Environment: tt.environ})
			if tt.expectedErrMsg != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedErrMsg)
				return
			}
			require.NoError(t, err)
			if tt.assertFunc != nil {
				tt.assertFunc(t, cfg)
			}
		})
	}
}

// environWith returns the smallest environment Load accepts, with extra
// variables added or replaced.
func environWith(extra map[string]string) map[string]string {
	environ := map[string]string{
		"RDB_USER":                  "lumei",
		"RDB_PASSWORD":              "secret",
		"AUTH_JWT_SIGNING_KEY":      "-----BEGIN PRIVATE KEY-----",
		"AUTH_TOKEN_ENCRYPTION_KEY": "a2V5",
	}
	for k, v := range extra {
		environ[k] = v
	}
	return environ
}
