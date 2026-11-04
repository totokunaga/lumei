package integration

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/totokunaga/lumei/backend/internal/config"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/database/rdb/driver"
	"github.com/totokunaga/lumei/backend/internal/infrastructure/token"
	"github.com/totokunaga/lumei/backend/internal/interface/generated"
)

const requestIDHeader = "X-Request-Id"

type req struct {
	method  string
	path    string
	headers map[string]string

	// body is sent as JSON. rawBody, if set, is sent as is instead, e.g. to
	// test a malformed body.
	body    any
	rawBody string
}

// response is what a test inspects after a request.
type response struct {
	status int
	header http.Header
	body   []byte
}

type testIntegrationInput struct {
	name string
	req  req

	// configure changes the case's own copy of the configuration before the
	// server is built, e.g. to shorten a timeout. Cases never change the
	// environment, so they can run in parallel.
	configure func(cfg *config.Config)

	// setupFunc runs before the server is built and may also change cfg. The
	// returned function, if any, runs after the server is built and before the
	// request is sent.
	setupFunc func(t *testing.T, cfg *config.Config) (afterStart func())

	// prepare, if set, replaces req and assertFunc for a case whose request
	// depends on earlier requests, e.g. one that needs a session token. It
	// runs after the server starts, may send those requests to ts, and
	// returns the request to test and the assertion for its response, which
	// may close over what the earlier requests returned.
	prepare func(t *testing.T, ts *TestServer) (req, func(t *testing.T, resp response))

	expectedStatus int

	// assertFunc asserts the rest of the response (body, headers). The status
	// is already checked against expectedStatus.
	assertFunc func(t *testing.T, resp response)
}

// runIntegrationTestCases builds a fresh server per case through the
// production wiring and sends the case's request to it. Cases run in parallel,
// each with its own configuration loaded from the suite's environment.
func runIntegrationTestCases(t *testing.T, tests []testIntegrationInput) {
	t.Helper()

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			cfg := loadConfig(t)
			if tt.configure != nil {
				tt.configure(cfg)
			}

			var afterStart func()
			if tt.setupFunc != nil {
				afterStart = tt.setupFunc(t, cfg)
			}

			ts := newTestServer(t, cfg)
			if afterStart != nil {
				afterStart()
			}

			r, assertFunc := tt.req, tt.assertFunc
			if tt.prepare != nil {
				r, assertFunc = tt.prepare(t, ts)
			}

			resp := do(t, ts, r)

			assert.Equal(t, tt.expectedStatus, resp.status, "body: %s", resp.body)
			if assertFunc != nil {
				assertFunc(t, resp)
			}
		})
	}
}

// loadConfig reads the configuration from the suite's environment, which
// TestMain fills in before any test runs.
func loadConfig(t *testing.T) *config.Config {
	t.Helper()

	cfg, err := config.Load()
	require.NoError(t, err)
	return &cfg
}

// do sends r to the test server and returns the response.
func do(t *testing.T, ts *TestServer, r req) response {
	t.Helper()

	var reqBody io.Reader = http.NoBody
	switch {
	case r.rawBody != "":
		reqBody = strings.NewReader(r.rawBody)
	case r.body != nil:
		encoded, err := json.Marshal(r.body)
		require.NoError(t, err)
		reqBody = bytes.NewReader(encoded)
	}

	httpReq, err := http.NewRequestWithContext(t.Context(), r.method, ts.BaseURL+r.path, reqBody)
	require.NoError(t, err)
	if reqBody != http.NoBody {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	for k, v := range r.headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := ts.Client().Do(httpReq)
	require.NoError(t, err)
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return response{status: resp.StatusCode, header: resp.Header, body: body}
}

// decode unmarshals a JSON response body into T.
func decode[T any](t *testing.T, body []byte) T {
	t.Helper()

	var v T
	require.NoError(t, json.Unmarshal(body, &v))
	return v
}

// assertBody builds an assertFunc requiring the body to decode to want exactly.
func assertBody[T any](want T) func(t *testing.T, resp response) {
	return func(t *testing.T, resp response) {
		t.Helper()

		assert.Equal(t, want, decode[T](t, resp.body))
	}
}

// assertAll builds an assertFunc running every given assertFunc in order.
func assertAll(fns ...func(t *testing.T, resp response)) func(t *testing.T, resp response) {
	return func(t *testing.T, resp response) {
		t.Helper()

		for _, fn := range fns {
			fn(t, resp)
		}
	}
}

// assertHeader builds an assertFunc requiring the header to equal want, or to
// be present with any value when want is empty.
func assertHeader(key, want string) func(t *testing.T, resp response) {
	return func(t *testing.T, resp response) {
		t.Helper()

		if want == "" {
			assert.NotEmpty(t, resp.header.Get(key), "%s is set", key)
			return
		}
		assert.Equal(t, want, resp.header.Get(key))
	}
}

// useDisposableDatabase is a setupFunc that points the server at a new, empty
// database and drops it once the server has started. Dropping with FORCE
// terminates the server's open connections, and reconnecting fails because the
// database no longer exists. The database is the case's own, so other cases
// running in parallel are unaffected.
func useDisposableDatabase(t *testing.T, cfg *config.Config) (afterStart func()) {
	t.Helper()

	admin, err := driver.NewPostgresDriver(cfg.RDB).Open(cfg.RDB.DSN())
	require.NoError(t, err)
	t.Cleanup(func() { _ = admin.Close() })

	suffix := make([]byte, 6)
	_, err = rand.Read(suffix)
	require.NoError(t, err)
	name := "lumei_disposable_" + hex.EncodeToString(suffix)

	_, err = admin.ExecContext(t.Context(), fmt.Sprintf(`CREATE DATABASE %q`, name))
	require.NoError(t, err)
	cfg.RDB.Name = name

	drop := func() {
		// Not t.Context(): this also runs from t.Cleanup, after it is canceled.
		query := fmt.Sprintf(`DROP DATABASE IF EXISTS %q WITH (FORCE)`, name)
		_, err := admin.ExecContext(context.Background(), query)
		require.NoError(t, err)
	}
	t.Cleanup(drop)
	return drop
}

// randomHex returns n random bytes as hex, for data unique to a case.
func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// uniqueEmail returns an email address no other case uses.
func uniqueEmail() string {
	return "user-" + randomHex(6) + "@example.com"
}

// The audiences the fake providers issue tokens for, which TestMain
// configures as the server's client IDs.
const (
	testAppleClientID  = "com.example.lumei.test"
	testGoogleClientID = "lumei-test.apps.googleusercontent.com"
)

// fakeIdentityProvider stands in for Sign in with Apple and Google. It serves
// a JWKS with its public key and signs ID tokens with the private key, so the
// tests exercise the server's real token verification.
type fakeIdentityProvider struct {
	server *httptest.Server
	key    *rsa.PrivateKey
	// strangerKey signs tokens the JWKS has no key for, i.e. forged tokens.
	strangerKey *rsa.PrivateKey
}

// idp is the suite's fake provider, started by TestMain before any test runs
// and only read by the tests.
var idp *fakeIdentityProvider

// newFakeIdentityProvider starts a fake provider. Close it with p.server.Close.
func newFakeIdentityProvider() *fakeIdentityProvider {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	strangerKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	jwks := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{
		Key: &key.PublicKey, KeyID: "test-key", Algorithm: string(jose.RS256), Use: "sig",
	}}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jwks)
	}))
	return &fakeIdentityProvider{server: server, key: key, strangerKey: strangerKey}
}

// env returns the variables that point the server's verification at p.
func (p *fakeIdentityProvider) env() map[string]string {
	return map[string]string{
		"AUTH_APPLE_JWKS_URL":    p.server.URL,
		"AUTH_APPLE_CLIENT_IDS":  testAppleClientID,
		"AUTH_GOOGLE_JWKS_URL":   p.server.URL,
		"AUTH_GOOGLE_CLIENT_IDS": testGoogleClientID,
	}
}

// idToken describes an ID token for the fake provider to sign. Build one with
// appleToken or googleToken, then change fields for a negative case.
type idToken struct {
	issuer   string
	audience string
	subject  string
	// email is omitted from the claims when empty.
	email string
	// emailVerified is the raw email_verified claim, omitted when nil.
	emailVerified any
	expiresAt     time.Time
	// forged signs the token with a key the JWKS doesn't publish.
	forged bool
	// extra adds or overrides claims.
	extra map[string]any
}

// appleToken returns a valid Sign in with Apple ID token for email, with
// email_verified as the string Apple has sent.
func appleToken(subject, email string) idToken {
	return idToken{
		issuer: "https://appleid.apple.com", audience: testAppleClientID,
		subject: subject, email: email, emailVerified: "true",
		expiresAt: time.Now().Add(10 * time.Minute),
	}
}

// googleToken returns a valid Google ID token for email.
func googleToken(subject, email string) idToken {
	return idToken{
		issuer: "https://accounts.google.com", audience: testGoogleClientID,
		subject: subject, email: email, emailVerified: true,
		expiresAt: time.Now().Add(10 * time.Minute),
	}
}

// sign returns the token as a signed JWT.
func (p *fakeIdentityProvider) sign(token idToken) string {
	claims := map[string]any{
		"iss": token.issuer,
		"aud": token.audience,
		"sub": token.subject,
		"iat": time.Now().Unix(),
		"exp": token.expiresAt.Unix(),
	}
	if token.email != "" {
		claims["email"] = token.email
	}
	if token.emailVerified != nil {
		claims["email_verified"] = token.emailVerified
	}
	for k, v := range token.extra {
		claims[k] = v
	}

	key := p.key
	if token.forged {
		key = p.strangerKey
	}
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "test-key"}},
		(&jose.SignerOptions{}).WithType("JWT"),
	)
	if err != nil {
		panic(err)
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		panic(err)
	}
	signed, err := signer.Sign(payload)
	if err != nil {
		panic(err)
	}
	jwt, err := signed.CompactSerialize()
	if err != nil {
		panic(err)
	}
	return jwt
}

// signInReq builds a POST /auth/sign-in request for provider and an ID token.
func signInReq(provider generated.SignInProvider, idToken string) req {
	return req{
		method: http.MethodPost,
		path:   "/auth/sign-in",
		body:   generated.SignInRequest{Provider: provider, IdToken: idToken},
	}
}

// signIn signs in to ts and returns the new session.
func signIn(t *testing.T, ts *TestServer, provider generated.SignInProvider, idToken string) generated.SessionResponse {
	t.Helper()

	resp := do(t, ts, signInReq(provider, idToken))
	require.Equal(t, http.StatusCreated, resp.status, "sign-in failed: %s", resp.body)
	return decode[generated.SessionResponse](t, resp.body)
}

// refreshReq builds a POST /auth/refresh request for refreshToken.
func refreshReq(refreshToken string) req {
	return req{
		method: http.MethodPost,
		path:   "/auth/refresh",
		body:   generated.RefreshSessionRequest{RefreshToken: refreshToken},
	}
}

// refresh refreshes a session on ts and returns the new tokens.
func refresh(t *testing.T, ts *TestServer, refreshToken string) generated.SessionResponse {
	t.Helper()

	resp := do(t, ts, refreshReq(refreshToken))
	require.Equal(t, http.StatusOK, resp.status, "refresh failed: %s", resp.body)
	return decode[generated.SessionResponse](t, resp.body)
}

// newGoogleSession signs in to ts as a new Google user and returns the session.
func newGoogleSession(t *testing.T, ts *TestServer) generated.SessionResponse {
	t.Helper()

	return signIn(t, ts, generated.Google, idp.sign(googleToken(newSubject(), uniqueEmail())))
}

// newSubject returns a provider subject no other case uses.
func newSubject() string {
	return "sub-" + randomHex(6)
}

// meReq builds a GET /me request authenticated with accessToken.
func meReq(accessToken string) req {
	return req{method: http.MethodGet, path: "/me", headers: bearer(accessToken)}
}

// categorySetsReq builds a GET /category-sets request authenticated with
// accessToken.
func categorySetsReq(accessToken string) req {
	return req{method: http.MethodGet, path: "/category-sets", headers: bearer(accessToken)}
}

// signOutReq builds a POST /auth/sign-out request authenticated with accessToken.
func signOutReq(accessToken string) req {
	return req{method: http.MethodPost, path: "/auth/sign-out", headers: bearer(accessToken)}
}

// bearer returns the headers that authenticate a request with accessToken.
func bearer(accessToken string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + accessToken}
}

// signingKey signs the server's access tokens. TestMain generates it and
// passes signingKeyPEM to the server as AUTH_JWT_SIGNING_KEY; the tests only
// read them.
var (
	signingKey    *ecdsa.PrivateKey
	signingKeyPEM string
)

// newSigningKey generates a P-256 key and returns it with its PKCS #8 PEM.
func newSigningKey() (*ecdsa.PrivateKey, string) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		panic(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		panic(err)
	}
	return key, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

// accessToken describes an access JWT for signAccessToken. Build one with
// validAccessToken, then change fields for a negative case.
type accessToken struct {
	// key signs the token, and keyID names a key in its header.
	key       *ecdsa.PrivateKey
	keyID     string
	issuer    string
	audience  string
	subject   string
	email     string
	sessionID string
	expiresAt time.Time
}

// validAccessToken describes a token the server would issue for a new user.
func validAccessToken(email string) accessToken {
	return accessToken{
		key:       signingKey,
		keyID:     token.KeyID(&signingKey.PublicKey),
		issuer:    token.Issuer,
		audience:  token.Audience,
		subject:   uuid.NewString(),
		email:     email,
		sessionID: uuid.NewString(),
		expiresAt: time.Now().Add(15 * time.Minute),
	}
}

// signAccessToken signs the token as a JWT with ES256.
func signAccessToken(t *testing.T, at accessToken) string {
	t.Helper()

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.ES256, Key: jose.JSONWebKey{Key: at.key, KeyID: at.keyID}},
		(&jose.SignerOptions{}).WithType("JWT"),
	)
	require.NoError(t, err)
	signed, err := jwt.Signed(signer).
		Claims(jwt.Claims{
			Issuer:   at.issuer,
			Audience: jwt.Audience{at.audience},
			Subject:  at.subject,
			Expiry:   jwt.NewNumericDate(at.expiresAt),
		}).
		Claims(map[string]any{"email": at.email, "sid": at.sessionID}).
		Serialize()
	require.NoError(t, err)
	return signed
}

// assertErrorCode builds an assertFunc requiring an ErrorResponse with code.
func assertErrorCode(code string) func(t *testing.T, resp response) {
	return func(t *testing.T, resp response) {
		t.Helper()

		assert.Equal(t, code, decode[generated.ErrorResponse](t, resp.body).Code)
	}
}
