package identity

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/config"
)

var _ application.SignInRevoker = (*Revoker)(nil)

// clientSecretTTL is how long an Apple client secret is valid. Each call
// signs a new one, so it only has to outlive the request.
const clientSecretTTL = 5 * time.Minute

// Revoker implements application.SignInRevoker with Apple's and Google's
// OAuth token and revoke endpoints (BR-ACC-05).
type Revoker struct {
	client *http.Client
	now    func() time.Time

	// apple signs Apple's client secrets; nil when no Apple key is set.
	apple          jose.Signer
	appleTeamID    string
	appleAudience  string
	appleTokenURL  string
	appleRevokeURL string

	// googleSecret is the web client's secret; empty when not set.
	googleSecret    string
	googleTokenURL  string
	googleRevokeURL string
}

// NewRevoker creates a Revoker for the providers cfg has credentials for. It
// fails if the Apple private key isn't a PEM-encoded P-256 key.
func NewRevoker(cfg config.AuthConfig, client *http.Client, now func() time.Time) (*Revoker, error) {
	r := &Revoker{
		client:          client,
		now:             now,
		appleTeamID:     cfg.AppleTeamID,
		appleAudience:   cfg.AppleIssuer,
		appleTokenURL:   cfg.AppleTokenURL,
		appleRevokeURL:  cfg.AppleRevokeURL,
		googleSecret:    cfg.GoogleClientSecret,
		googleTokenURL:  cfg.GoogleTokenURL,
		googleRevokeURL: cfg.GoogleRevokeURL,
	}
	if cfg.AppleRevocationEnabled() {
		signer, err := appleSigner(cfg.ApplePrivateKey, cfg.AppleKeyID)
		if err != nil {
			return nil, err
		}
		r.apple = signer
	}
	return r, nil
}

// appleSigner parses the .p8 key Apple issued and returns an ES256 signer
// that names it by keyID.
func appleSigner(privateKeyPEM, keyID string) (jose.Signer, error) {
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return nil, errors.New("AUTH_APPLE_PRIVATE_KEY is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse AUTH_APPLE_PRIVATE_KEY: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || key.Curve != elliptic.P256() {
		// Checked here, so a wrong key stops the server from starting
		// rather than the first account deletion.
		return nil, errors.New("AUTH_APPLE_PRIVATE_KEY is not a P-256 ECDSA key")
	}
	// ES256 with a P-256 ECDSA key is always a valid signer.
	signer, _ := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.ES256, Key: jose.JSONWebKey{Key: key, KeyID: keyID}},
		(&jose.SignerOptions{}).WithType("JWT"),
	)
	return signer, nil
}

// Exchange trades an authorization code for the refresh token that revokes
// the sign-in later.
func (r *Revoker) Exchange(
	ctx context.Context,
	provider application.Provider,
	clientID, code string,
) (application.ProviderToken, error) {

	var tokenURL string
	form := url.Values{"code": {code}, "grant_type": {"authorization_code"}, "client_id": {clientID}}
	switch {
	case provider == application.ProviderApple && r.apple != nil:
		secret, err := r.appleClientSecret(clientID)
		if err != nil {
			return application.ProviderToken{}, err
		}
		form.Set("client_secret", secret)
		tokenURL = r.appleTokenURL
	case provider == application.ProviderGoogle && r.googleSecret != "":
		form.Set("client_secret", r.googleSecret)
		// A server auth code from the mobile SDKs has no redirect URI.
		form.Set("redirect_uri", "")
		tokenURL = r.googleTokenURL
	default:
		return application.ProviderToken{},
			fmt.Errorf("%w: %s", application.ErrRevocationUnsupported, provider)
	}

	status, body, err := r.post(ctx, tokenURL, form)
	if err != nil {
		return application.ProviderToken{}, err
	}
	if status != http.StatusOK {
		return application.ProviderToken{}, fmt.Errorf("the %s token endpoint answered %d: %s",
			provider, status, oauthError(body))
	}
	var tokens struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(body, &tokens); err != nil {
		return application.ProviderToken{}, fmt.Errorf("failed to decode the %s tokens: %w", provider, err)
	}
	if tokens.RefreshToken == "" {
		return application.ProviderToken{},
			fmt.Errorf("the %s token endpoint returned no refresh token", provider)
	}
	return application.ProviderToken{ClientID: clientID, Token: tokens.RefreshToken}, nil
}

// Revoke revokes the refresh token, which ends the app's access to the
// sign-in.
func (r *Revoker) Revoke(
	ctx context.Context,
	provider application.Provider,
	token application.ProviderToken,
) error {

	var revokeURL string
	form := url.Values{"token": {token.Token}, "token_type_hint": {"refresh_token"}}
	switch {
	case provider == application.ProviderApple && r.apple != nil:
		secret, err := r.appleClientSecret(token.ClientID)
		if err != nil {
			return err
		}
		form.Set("client_id", token.ClientID)
		form.Set("client_secret", secret)
		revokeURL = r.appleRevokeURL
	case provider == application.ProviderGoogle && r.googleSecret != "":
		revokeURL = r.googleRevokeURL
	default:
		return fmt.Errorf("%w: %s", application.ErrRevocationUnsupported, provider)
	}

	status, body, err := r.post(ctx, revokeURL, form)
	if err != nil {
		return err
	}
	switch {
	case status == http.StatusOK:
		return nil
	case status == http.StatusBadRequest && isRevokedTokenError(oauthError(body)):
		// The user already removed the app's access, or the token expired.
		return nil
	case status >= http.StatusInternalServerError || status == http.StatusTooManyRequests:
		return fmt.Errorf("%w: the %s revoke endpoint answered %d",
			application.ErrRevocationUnavailable, provider, status)
	default:
		return fmt.Errorf("the %s revoke endpoint answered %d: %s", provider, status, oauthError(body))
	}
}

// appleClientSecret signs the short-lived JWT Apple accepts as the client
// secret of clientID.
func (r *Revoker) appleClientSecret(clientID string) (string, error) {
	now := r.now()
	secret, err := jwt.Signed(r.apple).Claims(jwt.Claims{
		Issuer:   r.appleTeamID,
		Subject:  clientID,
		Audience: jwt.Audience{r.appleAudience},
		IssuedAt: jwt.NewNumericDate(now),
		Expiry:   jwt.NewNumericDate(now.Add(clientSecretTTL)),
	}).Serialize()
	if err != nil {
		return "", fmt.Errorf("failed to sign the Apple client secret: %w", err)
	}
	return secret, nil
}

// post sends form to endpoint and returns the status and body. A request
// that doesn't get an answer wraps ErrRevocationUnavailable.
func (r *Revoker) post(ctx context.Context, endpoint string, form url.Values) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return 0, nil, fmt.Errorf("failed to build the request to %s: %w", endpoint, err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := r.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %w", application.ErrRevocationUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return 0, nil, fmt.Errorf("%w: failed to read the answer: %w",
			application.ErrRevocationUnavailable, err)
	}
	return resp.StatusCode, body, nil
}

// oauthError returns the error code of an OAuth error body, e.g.
// "invalid_grant", or "" if it has none.
func oauthError(body []byte) string {
	var answer struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(body, &answer)
	return answer.Error
}

// isRevokedTokenError reports whether an OAuth error code means the token
// no longer works, so there's nothing left to revoke.
func isRevokedTokenError(code string) bool {
	return code == "invalid_token" || code == "invalid_grant"
}
