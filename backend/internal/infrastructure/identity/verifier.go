// Package identity verifies the ID tokens that Sign in with Apple and Sign in
// with Google return to the app.
package identity

import (
	"context"
	"fmt"
	"net/http"
	"net/mail"
	"slices"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/config"
)

var _ application.IdentityVerifier = (*Verifier)(nil)

// Verifier implements application.IdentityVerifier with each provider's
// published signing keys (OpenID Connect ID tokens).
type Verifier struct {
	providers map[application.Provider]*provider
	devSignIn bool
}

// provider verifies one provider's ID tokens.
type provider struct {
	verifier *oidc.IDTokenVerifier
	// clientIDs are the audiences a token may be issued for. go-oidc checks
	// only one, so Verify checks the list itself.
	clientIDs []string
}

// New creates a Verifier for the providers cfg configures. A provider with no
// client IDs is disabled. client fetches the providers' signing keys, which
// are cached and refreshed when a token names an unknown key.
func New(cfg config.AuthConfig, client *http.Client) *Verifier {
	// go-oidc takes its HTTP client from a context, which it keeps for its
	// background key fetches. No request context fits, so it gets its own.
	ctx := oidc.ClientContext(context.Background(), client)

	providers := map[application.Provider]*provider{}
	add := func(name application.Provider, issuer, jwksURL string, clientIDs []string) {
		if len(clientIDs) == 0 {
			return
		}
		keys := oidc.NewRemoteKeySet(ctx, jwksURL)
		providers[name] = &provider{
			verifier:  oidc.NewVerifier(issuer, keys, &oidc.Config{SkipClientIDCheck: true}),
			clientIDs: clientIDs,
		}
	}
	add(application.ProviderApple, cfg.AppleIssuer, cfg.AppleJWKSURL, cfg.AppleClientIDs)
	add(application.ProviderGoogle, cfg.GoogleIssuer, cfg.GoogleJWKSURL, cfg.GoogleClientIDs)

	return &Verifier{providers: providers, devSignIn: cfg.DevSignIn}
}

// Verify checks the token's signature, issuer, audience, and expiry, and
// returns the identity it carries. For the dev provider, the token is the
// email address to sign in as.
func (v *Verifier) Verify(
	ctx context.Context,
	name application.Provider,
	idToken string,
) (application.Identity, error) {

	if name == application.ProviderDev && v.devSignIn {
		return devIdentity(idToken)
	}
	p, ok := v.providers[name]
	if !ok {
		return application.Identity{}, fmt.Errorf("%w: %q", application.ErrUnsupportedProvider, name)
	}

	token, err := p.verifier.Verify(ctx, idToken)
	if err != nil {
		return application.Identity{}, fmt.Errorf("%w: %w", application.ErrInvalidIDToken, err)
	}
	audience := slices.IndexFunc(token.Audience, func(aud string) bool {
		return slices.Contains(p.clientIDs, aud)
	})
	if audience < 0 {
		return application.Identity{}, fmt.Errorf("%w: unexpected audience %q",
			application.ErrInvalidIDToken, token.Audience)
	}
	if token.Subject == "" {
		return application.Identity{}, fmt.Errorf("%w: no subject", application.ErrInvalidIDToken)
	}

	var claims struct {
		Email         string   `json:"email"`
		EmailVerified jsonBool `json:"email_verified"`
	}
	if err := token.Claims(&claims); err != nil {
		return application.Identity{}, fmt.Errorf("%w: %w", application.ErrInvalidIDToken, err)
	}
	return application.Identity{
		Provider:      name,
		Subject:       token.Subject,
		Email:         claims.Email,
		EmailVerified: bool(claims.EmailVerified),
		ClientID:      token.Audience[audience],
	}, nil
}

// devIdentity returns a verified identity for the email address the dev
// provider is given, or ErrInvalidIDToken if it isn't one.
func devIdentity(email string) (application.Identity, error) {
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != strings.TrimSpace(email) {
		return application.Identity{}, fmt.Errorf("%w: not an email address", application.ErrInvalidIDToken)
	}
	return application.Identity{
		Provider:      application.ProviderDev,
		Subject:       strings.ToLower(address.Address),
		Email:         address.Address,
		EmailVerified: true,
	}, nil
}

// jsonBool decodes a JSON boolean, or a string "true" or "false". Google
// sends email_verified as a boolean; Apple has sent it as a string.
type jsonBool bool

// UnmarshalJSON accepts true, false, "true", "false", and null (false).
func (b *jsonBool) UnmarshalJSON(data []byte) error {
	switch string(data) {
	case "true", `"true"`:
		*b = true
	case "false", `"false"`, "null":
		*b = false
	default:
		return fmt.Errorf("not a boolean: %s", data)
	}
	return nil
}
