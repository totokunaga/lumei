package secretbox

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testBoxInput is a case of New, then Open on what setup returns.
type testBoxInput struct {
	name string
	// key is the base64 key New gets.
	key string
	// sealed returns the value to open, given the box New made.
	sealed func(box *Box) []byte
	// expectedOpened is what Open should return.
	expectedOpened string
	expectedErrMsg string
}

// runBoxTestCases runs each case in parallel: New with its key, then, if
// that succeeds, Open on its sealed value.
func runBoxTestCases(t *testing.T, tests []testBoxInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			box, err := New(tt.key)
			if err == nil {
				var opened []byte
				opened, err = box.Open(tt.sealed(box))
				if tt.expectedErrMsg == "" {
					require.NoError(t, err)
					assert.Equal(t, tt.expectedOpened, string(opened))
					return
				}
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.expectedErrMsg)
		})
	}
}
