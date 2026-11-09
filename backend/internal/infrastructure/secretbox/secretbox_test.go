package secretbox

import (
	"bytes"
	"testing"
)

// testKey is a valid 32-byte key, base64-encoded.
const testKey = "dGVzdC1vbmx5LWtleS1mb3ItbHVtZWktdG9rZW5zISE="

func TestBox(t *testing.T) {
	t.Parallel()

	tests := []testBoxInput{
		{
			name:           "opens what it sealed (BR-ACC-05)",
			key:            testKey,
			sealed:         func(box *Box) []byte { return box.Seal([]byte("refresh-token")) },
			expectedOpened: "refresh-token",
		},
		{
			name: "seals the same value differently each time",
			key:  testKey,
			sealed: func(box *Box) []byte {
				first, second := box.Seal([]byte("same")), box.Seal([]byte("same"))
				if bytes.Equal(first, second) {
					return nil
				}
				return second
			},
			expectedOpened: "same",
		},
		{
			name:           "rejects a key that isn't base64",
			key:            "not base64!",
			expectedErrMsg: "is not base64",
		},
		{
			name:           "rejects a key of the wrong length",
			key:            "c2hvcnQ=",
			expectedErrMsg: "has 5 bytes; it needs 32",
		},
		{
			name:           "fails to open a value shorter than a nonce",
			key:            testKey,
			sealed:         func(*Box) []byte { return []byte("short") },
			expectedErrMsg: "too short",
		},
		{
			name: "fails to open a changed value",
			key:  testKey,
			sealed: func(box *Box) []byte {
				sealed := box.Seal([]byte("refresh-token"))
				sealed[len(sealed)-1] ^= 1
				return sealed
			},
			expectedErrMsg: "failed to decrypt",
		},
		{
			name: "fails to open a value sealed under another key",
			key:  testKey,
			sealed: func(*Box) []byte {
				other, err := New("b3RoZXIta2V5LW9ubHktZm9yLWx1bWVpLXRlc3RzISE=")
				if err != nil {
					panic(err)
				}
				return other.Seal([]byte("refresh-token"))
			},
			expectedErrMsg: "failed to decrypt",
		},
	}

	runBoxTestCases(t, tests)
}
