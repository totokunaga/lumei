package config

import (
	"testing"

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
