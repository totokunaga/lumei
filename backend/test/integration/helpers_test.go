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
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
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
	// testAppleTeamID and testAppleKeyID name the Apple key the server signs
	// client secrets with; testGoogleClientSecret is the Google web client's
	// secret. The fake providers accept only these (BR-ACC-05).
	testAppleTeamID        = "TESTTEAM01"
	testAppleKeyID         = "TESTKEY001"
	testGoogleClientSecret = "test-google-secret"
)

// fakeIdentityProvider stands in for Sign in with Apple and Google. It serves
// a JWKS with its public key and signs ID tokens with the private key, so the
// tests exercise the server's real token verification.
//
// It also stands in for their OAuth token and revoke endpoints (BR-ACC-05).
// The token endpoints trade a code from newCode for the refresh token
// "rt-<rest of the code>", and the revoke endpoints record the tokens they
// revoke. The code's kind picks how the endpoints answer; see newCode.
type fakeIdentityProvider struct {
	server *httptest.Server
	key    *rsa.PrivateKey
	// strangerKey signs tokens the JWKS has no key for, i.e. forged tokens.
	strangerKey *rsa.PrivateKey
	// appleKey is the Sign in with Apple key the server signs client
	// secrets with, and appleKeyPEM its PKCS #8 PEM.
	appleKey    *ecdsa.PrivateKey
	appleKeyPEM string
	// revoked holds the refresh tokens the revoke endpoints accepted.
	revoked sync.Map
}

// The kinds of code newCode makes, which pick how the fake answers.
const (
	// codeValid trades for a token that revokes normally.
	codeValid = "valid"
	// codeUnknown is a code the token endpoints reject with invalid_grant.
	codeUnknown = "unknown"
	// codeAlreadyRevoked trades for a token the revoke endpoints no longer
	// know: they answer 400 invalid_token, as after the user removed the
	// app's access.
	codeAlreadyRevoked = "revoked"
	// codeUnavailable trades for a token the revoke endpoints answer 503 for.
	codeUnavailable = "unavailable"
	// codeRejected trades for a token the revoke endpoints answer 401
	// invalid_client for, as for a misconfigured client.
	codeRejected = "rejected"
)

// newCode returns an authorization code of a kind no other case uses.
func newCode(kind string) string {
	return "code-" + kind + "-" + randomHex(6)
}

// refreshTokenFor returns the refresh token the fake trades code for.
func refreshTokenFor(code string) string {
	return "rt-" + strings.TrimPrefix(code, "code-")
}

// wasRevoked reports whether a revoke endpoint accepted the token of code.
func (p *fakeIdentityProvider) wasRevoked(code string) bool {
	_, ok := p.revoked.Load(refreshTokenFor(code))
	return ok
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
	appleKey, appleKeyPEM := newSigningKey()
	p := &fakeIdentityProvider{key: key, strangerKey: strangerKey, appleKey: appleKey, appleKeyPEM: appleKeyPEM}

	jwks := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{
		Key: &key.PublicKey, KeyID: "test-key", Algorithm: string(jose.RS256), Use: "sig",
	}}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /apple/token", p.serveToken(p.appleClient))
	mux.HandleFunc("POST /google/token", p.serveToken(googleClient))
	mux.HandleFunc("POST /apple/revoke", p.serveRevoke(p.appleClient))
	mux.HandleFunc("POST /google/revoke", p.serveRevoke(func(url.Values) bool { return true }))
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jwks)
	})
	p.server = httptest.NewServer(mux)
	return p
}

// appleClient reports whether a request carries a client secret signed
// with the Apple key, for its own client ID, as Apple requires.
func (p *fakeIdentityProvider) appleClient(form url.Values) bool {
	secret, err := jwt.ParseSigned(form.Get("client_secret"), []jose.SignatureAlgorithm{jose.ES256})
	if err != nil || len(secret.Headers) != 1 || secret.Headers[0].KeyID != testAppleKeyID {
		return false
	}
	var claims jwt.Claims
	if err := secret.Claims(&p.appleKey.PublicKey, &claims); err != nil {
		return false
	}
	return claims.Issuer == testAppleTeamID && claims.Subject == form.Get("client_id") &&
		claims.Audience.Contains("https://appleid.apple.com") &&
		claims.ValidateWithLeeway(jwt.Expected{Time: time.Now()}, 0) == nil
}

// googleClient reports whether a request carries the Google web client's
// ID and secret.
func googleClient(form url.Values) bool {
	return form.Get("client_id") == testGoogleClientID && form.Get("client_secret") == testGoogleClientSecret
}

// serveToken answers a token request: the refresh token for a known code.
func (p *fakeIdentityProvider) serveToken(authorized func(url.Values) bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		code := r.PostForm.Get("code")
		switch {
		case !authorized(r.PostForm):
			writeOAuthError(w, http.StatusUnauthorized, "invalid_client")
		case r.PostForm.Get("grant_type") != "authorization_code" ||
			!strings.HasPrefix(code, "code-") || strings.HasPrefix(code, "code-"+codeUnknown):
			writeOAuthError(w, http.StatusBadRequest, "invalid_grant")
		default:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "at-" + randomHex(6), "refresh_token": refreshTokenFor(code),
				"token_type": "Bearer", "expires_in": 3600,
			})
		}
	}
}

// serveRevoke answers a revoke request as the token's kind says.
func (p *fakeIdentityProvider) serveRevoke(authorized func(url.Values) bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		token := r.PostForm.Get("token")
		switch {
		case !authorized(r.PostForm) || strings.HasPrefix(token, "rt-"+codeRejected):
			writeOAuthError(w, http.StatusUnauthorized, "invalid_client")
		case strings.HasPrefix(token, "rt-"+codeAlreadyRevoked):
			writeOAuthError(w, http.StatusBadRequest, "invalid_token")
		case strings.HasPrefix(token, "rt-"+codeUnavailable):
			w.WriteHeader(http.StatusServiceUnavailable)
		default:
			p.revoked.Store(token, true)
			w.WriteHeader(http.StatusOK)
		}
	}
}

// writeOAuthError answers with an OAuth error body.
func writeOAuthError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}

// env returns the variables that point the server's verification at p.
func (p *fakeIdentityProvider) env() map[string]string {
	return map[string]string{
		"AUTH_APPLE_JWKS_URL":    p.server.URL,
		"AUTH_APPLE_CLIENT_IDS":  testAppleClientID,
		"AUTH_GOOGLE_JWKS_URL":   p.server.URL,
		"AUTH_GOOGLE_CLIENT_IDS": testGoogleClientID,

		"AUTH_APPLE_TEAM_ID":        testAppleTeamID,
		"AUTH_APPLE_KEY_ID":         testAppleKeyID,
		"AUTH_APPLE_PRIVATE_KEY":    p.appleKeyPEM,
		"AUTH_APPLE_TOKEN_URL":      p.server.URL + "/apple/token",
		"AUTH_APPLE_REVOKE_URL":     p.server.URL + "/apple/revoke",
		"AUTH_GOOGLE_CLIENT_SECRET": testGoogleClientSecret,
		"AUTH_GOOGLE_TOKEN_URL":     p.server.URL + "/google/token",
		"AUTH_GOOGLE_REVOKE_URL":    p.server.URL + "/google/revoke",
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

// signInWithCodeReq builds a POST /auth/sign-in request that also carries
// the provider's authorization code (BR-ACC-05).
func signInWithCodeReq(provider generated.SignInProvider, idToken, code string) req {
	return req{
		method: http.MethodPost,
		path:   "/auth/sign-in",
		body:   generated.SignInRequest{Provider: provider, IdToken: idToken, AuthorizationCode: &code},
	}
}

// signInWithCode signs in to ts with an authorization code and returns the
// new session.
func signInWithCode(
	t *testing.T,
	ts *TestServer,
	provider generated.SignInProvider,
	idToken, code string,
) generated.SessionResponse {

	t.Helper()

	resp := do(t, ts, signInWithCodeReq(provider, idToken, code))
	require.Equal(t, http.StatusCreated, resp.status, "sign-in failed: %s", resp.body)
	return decode[generated.SessionResponse](t, resp.body)
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

// deleteMeReq builds a DELETE /me request authenticated with accessToken.
func deleteMeReq(accessToken string) req {
	return req{method: http.MethodDelete, path: "/me", headers: bearer(accessToken)}
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

// syncRow is a pushed or pulled row as JSON, so a case can also send fields
// the API must reject.
type syncRow map[string]any

// with returns a copy of the row with fields replaced; a nil value removes the field.
func (r syncRow) with(fields syncRow) syncRow {
	out := syncRow{}
	maps.Copy(out, r)
	for k, v := range fields {
		if v == nil {
			delete(out, k)
		} else {
			out[k] = v
		}
	}
	return out
}

// syncBaseTime is a fixed moment in the past every row is dated from, well
// within the API's clock.
var syncBaseTime = time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC).UnixMilli()

// newRowID returns a lower-case UUIDv7 no other case uses.
func newRowID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// settingsSyncRow builds the settings row of a user.
func settingsSyncRow(userID string, updatedAt int64) syncRow {
	return syncRow{
		"table": "settings", "id": userID, "updated_at": updatedAt, "deleted_at": nil,
		"region": "jp", "currency": "JPY", "period_start_day": 25,
		"big_purchase_spread": "daysLeft", "setup_completed_at": updatedAt,
	}
}

// categorySyncRow builds a category row.
func categorySyncRow(id string, updatedAt int64) syncRow {
	return syncRow{
		"table": "categories", "id": id, "updated_at": updatedAt, "deleted_at": nil,
		"name": "Eat Out", "emoji": "🍔", "position": 0, "archived_at": nil,
	}
}

// periodSyncRow builds a period row for Oct 25 – Nov 24.
func periodSyncRow(id string, updatedAt int64) syncRow {
	return syncRow{
		"table": "periods", "id": id, "updated_at": updatedAt, "deleted_at": nil,
		"start_date": "2026-10-25", "end_date": "2026-11-24",
	}
}

// incomeSyncRow builds an income row of a period.
func incomeSyncRow(id, periodID string, updatedAt int64) syncRow {
	return syncRow{
		"table": "incomes", "id": id, "updated_at": updatedAt, "deleted_at": nil,
		"period_id": periodID, "name": "Salary", "amount": 640808, "position": 0,
	}
}

// fixedExpenseSyncRow builds a fixed expense row of a period.
func fixedExpenseSyncRow(id, periodID string, updatedAt int64) syncRow {
	return syncRow{
		"table": "fixed_expenses", "id": id, "updated_at": updatedAt, "deleted_at": nil,
		"period_id": periodID, "name": "Rent", "amount": 85000, "note": "Originally ¥90,000", "position": 0,
	}
}

// savingTargetSyncRow builds a saving target row of a period.
func savingTargetSyncRow(id, periodID string, updatedAt int64) syncRow {
	return syncRow{
		"table": "saving_targets", "id": id, "updated_at": updatedAt, "deleted_at": nil,
		"period_id": periodID, "amount": 100000,
	}
}

// expenseSyncRow builds an expense row with a location.
func expenseSyncRow(id, categoryID string, updatedAt int64) syncRow {
	return syncRow{
		"table": "expenses", "id": id, "updated_at": updatedAt, "deleted_at": nil,
		"amount": 1200, "category_id": categoryID, "date": "2026-11-05", "spent_at": updatedAt,
		"is_big_purchase": false, "description": "Lunch", "latitude": 35.6812, "longitude": 139.7671,
	}
}

// pushReq builds a POST /sync/push request authenticated with accessToken.
func pushReq(accessToken string, rows ...syncRow) req {
	if rows == nil {
		rows = []syncRow{}
	}
	return req{
		method: http.MethodPost, path: "/sync/push", headers: bearer(accessToken),
		body: map[string]any{"rows": rows},
	}
}

// pullReq builds a GET /sync/pull request authenticated with accessToken.
func pullReq(accessToken string, since int64) req {
	return req{method: http.MethodGet, path: fmt.Sprintf("/sync/pull?since=%d", since), headers: bearer(accessToken)}
}

// push sends rows to ts and returns each row's outcome.
func push(t *testing.T, ts *TestServer, accessToken string, rows ...syncRow) []generated.PushResult {
	t.Helper()

	resp := do(t, ts, pushReq(accessToken, rows...))
	require.Equal(t, http.StatusOK, resp.status, "body: %s", resp.body)
	return decode[generated.PushResponse](t, resp.body).Results
}

// pull reads the changes after since from ts.
func pull(t *testing.T, ts *TestServer, accessToken string, since int64) pulled {
	t.Helper()

	resp := do(t, ts, pullReq(accessToken, since))
	require.Equal(t, http.StatusOK, resp.status, "body: %s", resp.body)
	return decodePull(t, resp.body)
}

// pulled is a pull's response with its rows as plain JSON, to compare with
// what was pushed.
type pulled struct {
	Rows    []syncRow `json:"rows"`
	Cursor  int64     `json:"cursor"`
	HasMore bool      `json:"has_more"`
}

// decodePull decodes a pull's response, keeping numbers as they were sent.
func decodePull(t *testing.T, body []byte) pulled {
	t.Helper()

	// Check the contract first, then decode again into plain JSON.
	_ = decode[generated.PullResponse](t, body)
	var out pulled
	require.NoError(t, json.Unmarshal(body, &out))
	return out
}

// normalized returns rows as they look after a JSON round trip, so pushed
// rows compare equal to pulled ones.
func normalized(t *testing.T, rows ...syncRow) []syncRow {
	t.Helper()

	encoded, err := json.Marshal(rows)
	require.NoError(t, err)
	var out []syncRow
	require.NoError(t, json.Unmarshal(encoded, &out))
	return out
}

// extraIncomeSyncRow builds an extra income row (BR-INC-06).
func extraIncomeSyncRow(id string, updatedAt int64) syncRow {
	return syncRow{
		"table": "extra_incomes", "id": id, "updated_at": updatedAt, "deleted_at": nil,
		"amount": 3000, "date": "2026-11-01", "received_at": updatedAt, "description": "Aki paid back dinner",
	}
}
