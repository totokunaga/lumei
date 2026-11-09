package identity

import (
	"context"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"net/http"
	"testing"

	"github.com/go-jose/go-jose/v4"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/config"
)

// failingSigner is a jose.Signer that can't sign, to reach the error of
// signing Apple's client secret.
type failingSigner struct{}

func (failingSigner) Sign([]byte) (*jose.JSONWebSignature, error) {
	return nil, errors.New("signer broken")
}

func (failingSigner) Options() jose.SignerOptions { return jose.SignerOptions{} }

// exchange returns a call that exchanges a code for provider.
func exchange(provider application.Provider) func(context.Context, *Revoker) error {
	return func(ctx context.Context, r *Revoker) error {
		_, err := r.Exchange(ctx, provider, "client", "code")
		return err
	}
}

// revoke returns a call that revokes a token for provider.
func revoke(provider application.Provider) func(context.Context, *Revoker) error {
	return func(ctx context.Context, r *Revoker) error {
		return r.Revoke(ctx, provider, application.ProviderToken{ClientID: "client", Token: "rt"})
	}
}

// The cases the integration tests can't reach (BR-ACC-05): broken Apple keys
// and signers, and providers that answer oddly or not at all.
func TestRevoker(t *testing.T) {
	t.Parallel()

	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tests := []testRevokerInput{
		{
			name:              "refuses an Apple key that isn't PEM",
			configure:         func(cfg *config.AuthConfig) { cfg.ApplePrivateKey = "not a key" },
			expectedNewErrMsg: "AUTH_APPLE_PRIVATE_KEY is not PEM",
		},
		{
			name: "refuses an Apple key that isn't PKCS #8",
			configure: func(cfg *config.AuthConfig) {
				cfg.ApplePrivateKey = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n"
			},
			expectedNewErrMsg: "failed to parse AUTH_APPLE_PRIVATE_KEY",
		},
		{
			name:              "refuses an Apple key that isn't ECDSA",
			configure:         func(cfg *config.AuthConfig) { cfg.ApplePrivateKey = pkcs8PEM(rsaKey) },
			expectedNewErrMsg: "AUTH_APPLE_PRIVATE_KEY is not a P-256 ECDSA key",
		},
		{
			name: "refuses an Apple key on a curve ES256 doesn't use",
			configure: func(cfg *config.AuthConfig) {
				cfg.ApplePrivateKey = pkcs8PEM(newECKey(elliptic.P384()))
			},
			expectedNewErrMsg: "AUTH_APPLE_PRIVATE_KEY is not a P-256 ECDSA key",
		},
		{
			name: "fails to exchange when Apple's client secret can't be signed",
			setup: func(r *Revoker) {
				r.apple = failingSigner{}
			},
			call:           exchange(application.ProviderApple),
			expectedErrMsg: "failed to sign the Apple client secret",
		},
		{
			name:           "fails to revoke when Apple's client secret can't be signed",
			setup:          func(r *Revoker) { r.apple = failingSigner{} },
			call:           revoke(application.ProviderApple),
			expectedErrMsg: "failed to sign the Apple client secret",
		},
		{
			name:             "ErrRevocationUnsupported for Apple without its key",
			configure:        func(cfg *config.AuthConfig) { cfg.AppleTeamID = "" },
			call:             exchange(application.ProviderApple),
			expectedErrMsg:   "isn't set up",
			expectedSentinel: application.ErrRevocationUnsupported,
		},
		{
			name:           "fails on token answers that aren't JSON",
			handler:        answer(http.StatusOK, "not json"),
			call:           exchange(application.ProviderGoogle),
			expectedErrMsg: "failed to decode the google tokens",
		},
		{
			name:           "fails on token answers without a refresh token",
			handler:        answer(http.StatusOK, `{"access_token":"at"}`),
			call:           exchange(application.ProviderGoogle),
			expectedErrMsg: "the google token endpoint returned no refresh token",
		},
		{
			name: "ErrRevocationUnavailable when the token endpoint can't be reached",
			configure: func(cfg *config.AuthConfig) {
				cfg.GoogleTokenURL = "http://127.0.0.1:1/token"
			},
			call:             exchange(application.ProviderGoogle),
			expectedErrMsg:   "unavailable",
			expectedSentinel: application.ErrRevocationUnavailable,
		},
		{
			name:             "ErrRevocationUnavailable when the provider is rate limiting",
			handler:          answer(http.StatusTooManyRequests, ""),
			call:             revoke(application.ProviderApple),
			expectedErrMsg:   "the apple revoke endpoint answered 429",
			expectedSentinel: application.ErrRevocationUnavailable,
		},
		{
			name: "ErrRevocationUnavailable when the answer is cut off",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				// Promise more than is sent, then hang up.
				w.Header().Set("Content-Length", "100")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte("{"))
				conn, _, err := http.NewResponseController(w).Hijack()
				if err == nil {
					_ = conn.Close()
				}
			},
			call:             revoke(application.ProviderGoogle),
			expectedErrMsg:   "failed to read the answer",
			expectedSentinel: application.ErrRevocationUnavailable,
		},
		{
			name:           "fails on an endpoint that isn't a URL",
			configure:      func(cfg *config.AuthConfig) { cfg.GoogleRevokeURL = "http://\x7f" },
			call:           revoke(application.ProviderGoogle),
			expectedErrMsg: "failed to build the request",
		},
	}

	runRevokerTestCases(t, tests)
}
