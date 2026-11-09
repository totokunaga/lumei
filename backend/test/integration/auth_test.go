package integration

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/token"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

// assertNewSession builds an assertFunc requiring tokens for a user with
// email: an access JWT the server's key signed for that user, valid for 15
// minutes, and a refresh token.
func assertNewSession(email string) func(t *testing.T, resp response) {
	return func(t *testing.T, resp response) {
		t.Helper()

		got := decode[generated.SessionResponse](t, resp.body)
		assert.Equal(t, email, got.User.Email)
		_, err := uuid.Parse(got.User.Id)
		require.NoError(t, err, "the user ID is a UUID")
		assert.NotEmpty(t, got.RefreshToken)
		assert.WithinDuration(t, time.Now().Add(15*time.Minute), got.AccessTokenExpiresAt, time.Minute)

		issuer, err := token.NewJWTIssuer(signingKeyPEM, "")
		require.NoError(t, err)
		claims, err := issuer.Verify(got.AccessToken, time.Now())
		require.NoError(t, err, "the access token is a valid JWT")
		assert.Equal(t, got.User.Id, claims.UserID.String())
		assert.Equal(t, email, claims.Email)
	}
}

// assertSessionUser builds an assertFunc requiring the session to belong to
// the user with id, or to any other user when same is false.
func assertSessionUser(id string, same bool) func(t *testing.T, resp response) {
	return func(t *testing.T, resp response) {
		t.Helper()

		got := decode[generated.SessionResponse](t, resp.body)
		if same {
			assert.Equal(t, id, got.User.Id, "the sign-in opens the existing account")
		} else {
			assert.NotEqual(t, id, got.User.Id, "the sign-in gets a separate account")
		}
	}
}

func TestSignIn(t *testing.T) {
	t.Parallel()

	googleEmail := uniqueEmail()
	appleEmail := uniqueEmail()
	devEmail := uniqueEmail()

	expired := googleToken(newSubject(), uniqueEmail())
	expired.expiresAt = time.Now().Add(-time.Minute)
	forged := googleToken(newSubject(), uniqueEmail())
	forged.forged = true
	otherApp := googleToken(newSubject(), uniqueEmail())
	otherApp.audience = "someone-else.apps.googleusercontent.com"
	otherIssuer := googleToken(newSubject(), uniqueEmail())
	otherIssuer.issuer = "https://evil.example.com"
	noSubject := googleToken("", uniqueEmail())
	malformedEmail := googleToken(newSubject(), "")
	malformedEmail.extra = map[string]any{"email": 42}
	malformedVerified := appleToken(newSubject(), uniqueEmail())
	malformedVerified.emailVerified = 1
	unverified := googleToken(newSubject(), uniqueEmail())
	unverified.emailVerified = false
	noEmail := appleToken(newSubject(), "")

	tests := []testIntegrationInput{
		{
			name:           "201 creating an account on the first Google sign-in (BR-ACC-01)",
			req:            signInReq(generated.Google, idp.sign(googleToken(newSubject(), googleEmail))),
			expectedStatus: http.StatusCreated,
			assertFunc:     assertNewSession(googleEmail),
		},
		{
			name:           "201 creating an account on the first Apple sign-in (email_verified as a string)",
			req:            signInReq(generated.Apple, idp.sign(appleToken(newSubject(), appleEmail))),
			expectedStatus: http.StatusCreated,
			assertFunc:     assertNewSession(appleEmail),
		},
		{
			name: "201 with an authorization code the provider doesn't accept, storing no token (BR-ACC-05)",
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				email := uniqueEmail()
				return signInWithCodeReq(generated.Apple, idp.sign(appleToken(newSubject(), email)),
					newCode(codeUnknown)), assertNewSession(email)
			},
			expectedStatus: http.StatusCreated,
		},
		{
			name: "201 with an authorization code where Apple revocation isn't set up",
			configure: func(cfg *config.Config) {
				cfg.Auth.AppleTeamID, cfg.Auth.AppleKeyID, cfg.Auth.ApplePrivateKey = "", "", ""
			},
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				email := uniqueEmail()
				return signInWithCodeReq(generated.Apple, idp.sign(appleToken(newSubject(), email)),
					newCode(codeValid)), assertNewSession(email)
			},
			expectedStatus: http.StatusCreated,
		},
		{
			name: "201 storing the newest token when the same sign-in comes back with a code",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				token := googleToken(newSubject(), uniqueEmail())
				first := signInWithCode(t, ts, generated.Google, idp.sign(token), newCode(codeValid))
				return signInWithCodeReq(generated.Google, idp.sign(token), newCode(codeValid)),
					assertSessionUser(first.User.Id, true)
			},
			expectedStatus: http.StatusCreated,
		},
		{
			name: "201 opening the same account on the next sign-in with the same Google account",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				token := googleToken(newSubject(), uniqueEmail())
				first := signIn(t, ts, generated.Google, idp.sign(token))
				return signInReq(generated.Google, idp.sign(token)), assertSessionUser(first.User.Id, true)
			},
			expectedStatus: http.StatusCreated,
		},
		{
			name: "201 opening the Google account from an Apple sign-in with the same email (BR-ACC-07)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				email := uniqueEmail()
				first := signIn(t, ts, generated.Google, idp.sign(googleToken(newSubject(), email)))
				// In upper case: an email matches in any case.
				apple := appleToken(newSubject(), strings.ToUpper(email))
				return signInReq(generated.Apple, idp.sign(apple)), assertSessionUser(first.User.Id, true)
			},
			expectedStatus: http.StatusCreated,
		},
		{
			name: "201 keeping both linked sign-ins working (BR-ACC-07)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				email := uniqueEmail()
				google := googleToken(newSubject(), email)
				first := signIn(t, ts, generated.Google, idp.sign(google))
				signIn(t, ts, generated.Apple, idp.sign(appleToken(newSubject(), email)))
				return signInReq(generated.Google, idp.sign(google)), assertSessionUser(first.User.Id, true)
			},
			expectedStatus: http.StatusCreated,
		},
		{
			name: "201 creating a separate account for a different email, e.g. Hide My Email (BR-ACC-08)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				first := newGoogleSession(t, ts)
				relay := appleToken(newSubject(), randomHex(6)+"@privaterelay.appleid.com")
				return signInReq(generated.Apple, idp.sign(relay)), assertSessionUser(first.User.Id, false)
			},
			expectedStatus: http.StatusCreated,
		},
		{
			name:           "201 with dev sign-in where the server enables it",
			req:            signInReq(generated.Dev, devEmail),
			configure:      func(cfg *config.Config) { cfg.Auth.DevSignIn = true },
			expectedStatus: http.StatusCreated,
			assertFunc:     assertNewSession(devEmail),
		},
		{
			name:           "400 with dev sign-in where the server doesn't enable it",
			req:            signInReq(generated.Dev, uniqueEmail()),
			expectedStatus: http.StatusBadRequest,
			assertFunc:     assertErrorCode("unsupported_provider"),
		},
		{
			name:           "400 for an unknown provider",
			req:            signInReq("facebook", "token"),
			expectedStatus: http.StatusBadRequest,
			assertFunc:     assertErrorCode("unsupported_provider"),
		},
		{
			name:           "400 for Google sign-in when the server has no Google client ID",
			req:            signInReq(generated.Google, idp.sign(googleToken(newSubject(), uniqueEmail()))),
			configure:      func(cfg *config.Config) { cfg.Auth.GoogleClientIDs = nil },
			expectedStatus: http.StatusBadRequest,
			assertFunc:     assertErrorCode("unsupported_provider"),
		},
		{
			name:           "400 without an id_token",
			req:            signInReq(generated.Google, ""),
			expectedStatus: http.StatusBadRequest,
			assertFunc:     assertErrorCode("invalid_request"),
		},
		{
			name:           "400 for a body that isn't JSON",
			req:            req{method: http.MethodPost, path: "/auth/sign-in", rawBody: "{"},
			expectedStatus: http.StatusBadRequest,
			assertFunc:     assertErrorCode("invalid_request"),
		},
		{
			name:           "401 for a token that isn't a JWT",
			req:            signInReq(generated.Google, "not-a-jwt"),
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("invalid_id_token"),
		},
		{
			name:           "401 for a token signed with a key the provider doesn't publish",
			req:            signInReq(generated.Google, idp.sign(forged)),
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("invalid_id_token"),
		},
		{
			name:           "401 for an expired token",
			req:            signInReq(generated.Google, idp.sign(expired)),
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("invalid_id_token"),
		},
		{
			name:           "401 for a token issued to another app",
			req:            signInReq(generated.Google, idp.sign(otherApp)),
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("invalid_id_token"),
		},
		{
			name:           "401 for a token from another issuer",
			req:            signInReq(generated.Google, idp.sign(otherIssuer)),
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("invalid_id_token"),
		},
		{
			name:           "401 for a token without a subject",
			req:            signInReq(generated.Google, idp.sign(noSubject)),
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("invalid_id_token"),
		},
		{
			name:           "401 for a token whose email isn't a string",
			req:            signInReq(generated.Google, idp.sign(malformedEmail)),
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("invalid_id_token"),
		},
		{
			name:           "401 for a token whose email_verified isn't a boolean",
			req:            signInReq(generated.Apple, idp.sign(malformedVerified)),
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("invalid_id_token"),
		},
		{
			name:           "401 with dev sign-in for something other than a bare email address",
			req:            signInReq(generated.Dev, "Alice <alice@example.com>"),
			configure:      func(cfg *config.Config) { cfg.Auth.DevSignIn = true },
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("invalid_id_token"),
		},
		{
			name:           "403 when Google doesn't report the email as verified",
			req:            signInReq(generated.Google, idp.sign(unverified)),
			expectedStatus: http.StatusForbidden,
			assertFunc:     assertErrorCode("email_not_verified"),
		},
		{
			name:           "403 for a token without an email",
			req:            signInReq(generated.Apple, idp.sign(noEmail)),
			expectedStatus: http.StatusForbidden,
			assertFunc:     assertErrorCode("email_not_verified"),
		},
		{
			name:           "500 when the database goes away",
			req:            signInReq(generated.Google, idp.sign(googleToken(newSubject(), uniqueEmail()))),
			setupFunc:      useDisposableDatabase,
			expectedStatus: http.StatusInternalServerError,
			assertFunc:     assertErrorCode("internal_error"),
		},
	}

	runIntegrationTestCases(t, tests)
}

func TestRefreshSession(t *testing.T) {
	t.Parallel()

	tests := []testIntegrationInput{
		{
			name: "200 with new tokens that work, replacing the refresh token (BR-ACC-03)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				return refreshReq(session.RefreshToken), func(t *testing.T, resp response) {
					t.Helper()

					got := decode[generated.SessionResponse](t, resp.body)
					assert.Equal(t, session.User, got.User)
					assert.NotEqual(t, session.RefreshToken, got.RefreshToken)
					me := do(t, ts, meReq(got.AccessToken))
					assert.Equal(t, http.StatusOK, me.status)
				}
			},
			expectedStatus: http.StatusOK,
		},
		{
			name: "200 for a refresh token replaced within the last minute, e.g. after a lost response",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				refresh(t, ts, session.RefreshToken)
				return refreshReq(session.RefreshToken), assertNewSession(session.User.Email)
			},
			expectedStatus: http.StatusOK,
		},
		{
			name:      "401 for a replaced refresh token reused later, ending the session",
			configure: func(cfg *config.Config) { cfg.Auth.RefreshReuseGrace = 0 },
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				latest := refresh(t, ts, session.RefreshToken)
				return refreshReq(session.RefreshToken), func(t *testing.T, _ response) {
					t.Helper()

					again := do(t, ts, refreshReq(latest.RefreshToken))
					assert.Equal(t, http.StatusUnauthorized, again.status,
						"the latest refresh token is revoked too")
				}
			},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:      "401 once the session has expired (BR-ACC-03)",
			configure: func(cfg *config.Config) { cfg.Auth.SessionTTL = time.Nanosecond },
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				return refreshReq(session.RefreshToken), assertErrorCode("unauthenticated")
			},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "401 for an unknown refresh token",
			req:            refreshReq(randomHex(32)),
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("unauthenticated"),
		},
		{
			name:           "400 without a refresh_token",
			req:            refreshReq(""),
			expectedStatus: http.StatusBadRequest,
			assertFunc:     assertErrorCode("invalid_request"),
		},
		{
			name:           "400 for a body that isn't JSON",
			req:            req{method: http.MethodPost, path: "/auth/refresh", rawBody: "{"},
			expectedStatus: http.StatusBadRequest,
			assertFunc:     assertErrorCode("invalid_request"),
		},
		{
			name:           "500 when the database goes away",
			req:            refreshReq(randomHex(32)),
			setupFunc:      useDisposableDatabase,
			expectedStatus: http.StatusInternalServerError,
			assertFunc:     assertErrorCode("internal_error"),
		},
	}

	runIntegrationTestCases(t, tests)
}

func TestSignOut(t *testing.T) {
	t.Parallel()

	tests := []testIntegrationInput{
		{
			name: "204 ending the session, so its refresh token stops working (BR-ACC-04)",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				session := newGoogleSession(t, ts)
				return signOutReq(session.AccessToken), func(t *testing.T, _ response) {
					t.Helper()

					again := do(t, ts, refreshReq(session.RefreshToken))
					assert.Equal(t, http.StatusUnauthorized, again.status)
				}
			},
			expectedStatus: http.StatusNoContent,
		},
		{
			name: "204 leaving the user's other devices signed in",
			prepare: func(t *testing.T, ts *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				token := googleToken(newSubject(), uniqueEmail())
				phone := signIn(t, ts, generated.Google, idp.sign(token))
				tablet := signIn(t, ts, generated.Google, idp.sign(token))
				return signOutReq(phone.AccessToken), func(t *testing.T, _ response) {
					t.Helper()

					refresh(t, ts, tablet.RefreshToken)
				}
			},
			expectedStatus: http.StatusNoContent,
		},
		{
			name:           "401 without an access token",
			req:            req{method: http.MethodPost, path: "/auth/sign-out"},
			expectedStatus: http.StatusUnauthorized,
			assertFunc:     assertErrorCode("unauthenticated"),
		},
		{
			name: "500 when the database goes away",
			prepare: func(t *testing.T, _ *TestServer) (req, func(*testing.T, response)) {
				t.Helper()

				// The access token needs no database, so the request reaches
				// the deletion, which does.
				return signOutReq(signAccessToken(t, validAccessToken(uniqueEmail()))),
					assertErrorCode("internal_error")
			},
			setupFunc:      useDisposableDatabase,
			expectedStatus: http.StatusInternalServerError,
		},
	}

	runIntegrationTestCases(t, tests)
}
