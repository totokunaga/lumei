package integration

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

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

// assertAccountDeleted checks that the account of session, signed in with
// idToken, is gone (BR-ACC-05): its refresh token and pushes fail, and the
// same sign-in then opens a new, empty account.
func assertAccountDeleted(
	ts *TestServer,
	session generated.SessionResponse,
	provider generated.SignInProvider,
	idToken string,
) func(*testing.T, response) {

	return func(t *testing.T, _ response) {
		t.Helper()

		refreshed := do(t, ts, refreshReq(session.RefreshToken))
		assert.Equal(t, http.StatusUnauthorized, refreshed.status, "refresh: %s", refreshed.body)

		// The access token still verifies, but nothing can be written with it.
		pushed := do(t, ts, pushReq(session.AccessToken, categorySyncRow(newRowID(), time.Now().UnixMilli())))
		assert.Equal(t, http.StatusUnauthorized, pushed.status, "push: %s", pushed.body)
		assertErrorCode("unauthenticated")(t, pushed)

		again := signIn(t, ts, provider, idToken)
		assert.NotEqual(t, session.User.Id, again.User.Id, "the same sign-in opened the deleted account")
		assert.Empty(t, pull(t, ts, again.AccessToken, 0).Rows)
	}
}

// newAccountWithData signs in with a code and pushes a category and an
// expense with a location, so a deletion has data to remove.
func newAccountWithData(
	t *testing.T,
	ts *TestServer,
	provider generated.SignInProvider,
	idToken, code string,
) generated.SessionResponse {

	t.Helper()

	session := signInWithCode(t, ts, provider, idToken, code)
	now := time.Now().UnixMilli()
	categoryID := newRowID()
	push(t, ts, session.AccessToken,
		categorySyncRow(categoryID, now), expenseSyncRow(newRowID(), categoryID, now))
	require.Len(t, pull(t, ts, session.AccessToken, 0).Rows, 2)
	return session
}

func TestDeleteMe(t *testing.T) {
	t.Parallel()

	// The session the credentials-removed case signs in with, on a server
	// that still has them. Only that case reads it, after writing it.
	var signedInWithSecret generated.SessionResponse

	tests := []testIntegrationInput{
		{
			name: "204 deleting the account and its data, and revoking its Google sign-in (BR-ACC-05)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				idToken := idp.sign(googleToken(newSubject(), uniqueEmail()))
				code := newCode(codeValid)
				session := newAccountWithData(t, ts, generated.Google, idToken, code)
				return deleteMeReq(session.AccessToken), assertAll(
					assertAccountDeleted(ts, session, generated.Google, idToken),
					func(t *testing.T, _ response) {
						t.Helper()
						assert.True(t, idp.wasRevoked(code), "the Google sign-in wasn't revoked")
					},
				)
			},
			expectedStatus: http.StatusNoContent,
		},
		{
			name: "204 revoking every sign-in linked to the account, Apple and Google (BR-ACC-05, BR-ACC-07)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				email := uniqueEmail()
				googleCode, appleCode := newCode(codeValid), newCode(codeValid)
				appleIDToken := idp.sign(appleToken(newSubject(), email))
				google := newAccountWithData(t, ts, generated.Google,
					idp.sign(googleToken(newSubject(), email)), googleCode)
				apple := signInWithCode(t, ts, generated.Apple, appleIDToken, appleCode)
				require.Equal(t, google.User.Id, apple.User.Id)

				return deleteMeReq(apple.AccessToken), assertAll(
					assertAccountDeleted(ts, google, generated.Apple, appleIDToken),
					func(t *testing.T, _ response) {
						t.Helper()
						assert.True(t, idp.wasRevoked(googleCode), "the Google sign-in wasn't revoked")
						assert.True(t, idp.wasRevoked(appleCode), "the Apple sign-in wasn't revoked")
					},
				)
			},
			expectedStatus: http.StatusNoContent,
		},
		{
			name: "204 for a sign-in without a stored token, e.g. one made before tokens were stored",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				idToken := idp.sign(appleToken(newSubject(), uniqueEmail()))
				session := signIn(t, ts, generated.Apple, idToken)
				return deleteMeReq(session.AccessToken),
					assertAccountDeleted(ts, session, generated.Apple, idToken)
			},
			expectedStatus: http.StatusNoContent,
		},
		{
			name: "204 when the user already removed the app's access to the sign-in",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				idToken := idp.sign(googleToken(newSubject(), uniqueEmail()))
				session := newAccountWithData(t, ts, generated.Google, idToken, newCode(codeAlreadyRevoked))
				return deleteMeReq(session.AccessToken),
					assertAccountDeleted(ts, session, generated.Google, idToken)
			},
			expectedStatus: http.StatusNoContent,
		},
		{
			name: "204 once a provider's credentials are removed, deleting without revoking it",
			setupFunc: func(t *testing.T, cfg *config.Config) func() {
				t.Helper()

				// A server with the Google secret stores the token first.
				withSecret := newTestServer(t, cfg)
				idToken := idp.sign(googleToken(newSubject(), uniqueEmail()))
				signedInWithSecret = newAccountWithData(t, withSecret, generated.Google,
					idToken, newCode(codeValid))
				cfg.Auth.GoogleClientSecret = ""
				return func() {}
			},
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				return deleteMeReq(signedInWithSecret.AccessToken), nil
			},
			expectedStatus: http.StatusNoContent,
		},
		{
			name: "503 revocation_unavailable, deleting nothing, when a provider can't revoke now",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				idToken := idp.sign(googleToken(newSubject(), uniqueEmail()))
				session := newAccountWithData(t, ts, generated.Google, idToken, newCode(codeUnavailable))
				return deleteMeReq(session.AccessToken), assertAll(
					assertErrorCode("revocation_unavailable"),
					func(t *testing.T, _ response) {
						t.Helper()
						renewed := refresh(t, ts, session.RefreshToken)
						assert.Len(t, pull(t, ts, renewed.AccessToken, 0).Rows, 2)
					},
				)
			},
			expectedStatus: http.StatusServiceUnavailable,
		},
		{
			name: "503 revocation_unavailable when a provider can't be reached",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newAccountWithData(t, ts, generated.Google,
					idp.sign(googleToken(newSubject(), uniqueEmail())), newCode(codeValid))
				return deleteMeReq(session.AccessToken), assertErrorCode("revocation_unavailable")
			},
			configure: func(cfg *config.Config) {
				// Nothing listens on port 1 of the loopback address.
				cfg.Auth.GoogleRevokeURL = "http://127.0.0.1:1/revoke"
			},
			expectedStatus: http.StatusServiceUnavailable,
		},
		{
			name: "500 when a provider rejects the server's credentials",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newAccountWithData(t, ts, generated.Apple,
					idp.sign(appleToken(newSubject(), uniqueEmail())), newCode(codeRejected))
				return deleteMeReq(session.AccessToken), assertErrorCode("internal_error")
			},
			expectedStatus: http.StatusInternalServerError,
		},
		{
			name:           "401 without an access token",
			req:            req{method: http.MethodDelete, path: "/me"},
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("unauthenticated"),
		},
	}

	runIntegrationTestCases(t, tests)
}
