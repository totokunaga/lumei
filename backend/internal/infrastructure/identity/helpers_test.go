package identity

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/config"
)

// testRevokerInput is a case of a Revoker against a fake provider.
type testRevokerInput struct {
	name string
	// handler answers every request to the provider's endpoints.
	handler http.HandlerFunc
	// configure changes the config, whose endpoints all point at handler.
	configure func(cfg *config.AuthConfig)
	// setup changes the Revoker after NewRevoker made it.
	setup func(r *Revoker)
	// call runs the method under test.
	call func(ctx context.Context, r *Revoker) error

	// expectedNewErrMsg is the error NewRevoker should return; call doesn't
	// run then.
	expectedNewErrMsg string
	expectedErrMsg    string
	// expectedSentinel, if set, must be in the error's chain.
	expectedSentinel error
}

// runRevokerTestCases runs each case in parallel, with its own fake provider.
func runRevokerTestCases(t *testing.T, tests []testRevokerInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			handler := tt.handler
			if handler == nil {
				handler = func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }
			}
			server := httptest.NewServer(handler)
			t.Cleanup(server.Close)

			cfg := revokerConfig(server.URL)
			if tt.configure != nil {
				tt.configure(&cfg)
			}
			r, err := NewRevoker(cfg, server.Client(), time.Now)
			if tt.expectedNewErrMsg != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.expectedNewErrMsg)
				return
			}
			require.NoError(t, err)
			if tt.setup != nil {
				tt.setup(r)
			}

			err = tt.call(context.Background(), r)
			if tt.expectedErrMsg == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.expectedErrMsg)
			if tt.expectedSentinel != nil {
				assert.ErrorIs(t, err, tt.expectedSentinel)
			}
		})
	}
}

// revokerConfig returns a config with Apple and Google credentials, whose
// token and revoke endpoints are all at url.
func revokerConfig(url string) config.AuthConfig {
	return config.AuthConfig{
		AppleIssuer:        "https://appleid.apple.com",
		AppleTeamID:        "TEAM",
		AppleKeyID:         "KEY",
		ApplePrivateKey:    pkcs8PEM(newECKey(elliptic.P256())),
		AppleTokenURL:      url,
		AppleRevokeURL:     url,
		GoogleClientSecret: "secret",
		GoogleTokenURL:     url,
		GoogleRevokeURL:    url,
	}
}

// newECKey generates an ECDSA key on curve.
func newECKey(curve elliptic.Curve) *ecdsa.PrivateKey {
	key, err := ecdsa.GenerateKey(curve, rand.Reader)
	if err != nil {
		panic(err)
	}
	return key
}

// pkcs8PEM encodes key as a PKCS #8 PEM block, as Apple's .p8 files are.
func pkcs8PEM(key any) string {
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		panic(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

// answer returns a handler that answers every request with status and body.
func answer(status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}
}
