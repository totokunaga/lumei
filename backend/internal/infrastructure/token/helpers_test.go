package token

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testIssuerInput is a case of NewJWTIssuer.
type testIssuerInput struct {
	name           string
	signingKey     string
	previousKey    string
	expectedErrMsg string
}

// runIssuerTestCases builds an issuer from each case's keys, in parallel, and
// checks the error it returns.
func runIssuerTestCases(t *testing.T, tests []testIssuerInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			issuer, err := NewJWTIssuer(tt.signingKey, tt.previousKey)
			if tt.expectedErrMsg == "" {
				require.NoError(t, err)
				assert.NotNil(t, issuer)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.expectedErrMsg)
		})
	}
}
