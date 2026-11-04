package integration

import (
	"net/http"
	"testing"
	"time"

	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/token"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

func TestGetMe(t *testing.T) {
	t.Parallel()

	tests := []testIntegrationInput{
		{
			name: "200 with the signed-in user (BR-ACC-03)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				return meReq(session.AccessToken),
					assertBody(session.User)
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 with each user's own account only (BR-ACC-02)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				newGoogleSession(t, ts)
				other := signIn(t, ts, generated.Apple, idp.sign(appleToken(newSubject(), uniqueEmail())))
				return meReq(other.AccessToken),
					assertBody(other.User)
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 with the auth scheme in lower case",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				headers := map[string]string{"Authorization": "bearer " + session.AccessToken}
				return req{method: http.MethodGet, path: "/me", headers: headers}, assertBody(session.User)
			},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "401 without an Authorization header",
			req:            req{method: http.MethodGet, path: "/me"},
			expectedStatus: http.StatusUnauthorized,
			assertFunc: assertAll(
				assertErrorCode("unauthenticated"),
				assertHeader("WWW-Authenticate", "Bearer"),
			),
		},
		{
			name: "401 with another auth scheme",
			req: req{
				method:  http.MethodGet,
				path:    "/me",
				headers: map[string]string{"Authorization": "Basic dXNlcjpwYXNz"},
			},
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("unauthenticated"),
		},
		{
			name: "200 for a token signed with the previous key after a key rotation",
			configure: func(cfg *config.Config) {
				_, cfg.Auth.JWTSigningKey = newSigningKey()
				cfg.Auth.JWTPreviousSigningKey = signingKeyPEM
			},
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				at := validAccessToken(uniqueEmail())
				want := generated.User{Id: at.subject, Email: at.email}
				return meReq(signAccessToken(t, at)), assertBody(want)
			},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "401 for a token that isn't a JWT",
			req:            meReq(randomHex(32)),
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("unauthenticated"),
		},
		{
			name: "401 for a token signed with a key the server doesn't have",
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				at := validAccessToken(uniqueEmail())
				at.key, _ = newSigningKey()
				at.keyID = token.KeyID(&at.key.PublicKey)
				return meReq(signAccessToken(t, at)), assertErrorCode("unauthenticated")
			},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name: "401 for a forged token that names the server's key",
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				at := validAccessToken(uniqueEmail())
				at.key, _ = newSigningKey()
				return meReq(signAccessToken(t, at)), assertErrorCode("unauthenticated")
			},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name: "401 for a token from another issuer",
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				at := validAccessToken(uniqueEmail())
				at.issuer = "someone-else"
				return meReq(signAccessToken(t, at)), assertErrorCode("unauthenticated")
			},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name: "401 for a token issued to another audience",
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				at := validAccessToken(uniqueEmail())
				at.audience = "someone-else"
				return meReq(signAccessToken(t, at)), assertErrorCode("unauthenticated")
			},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name: "401 for a token whose subject isn't a user ID",
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				at := validAccessToken(uniqueEmail())
				at.subject = "admin"
				return meReq(signAccessToken(t, at)), assertErrorCode("unauthenticated")
			},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:      "401 once the access token has expired",
			configure: func(cfg *config.Config) { cfg.Auth.AccessTokenTTL = time.Nanosecond },
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				return meReq(session.AccessToken),
					assertErrorCode("unauthenticated")
			},
			expectedStatus: http.StatusUnauthorized,
		},
	}

	runIntegrationTestCases(t, tests)
}
