package application

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Provider names the service a user signs in with (BR-ACC-01).
type Provider string

const (
	// ProviderApple is Sign in with Apple.
	ProviderApple Provider = "apple"
	// ProviderGoogle is Sign in with Google.
	ProviderGoogle Provider = "google"
	// ProviderDev signs in as any email without proof, for local development
	// only. It is rejected unless the config enables it.
	ProviderDev Provider = "dev"
)

var (
	// ErrUnsupportedProvider is returned for a provider that doesn't exist or
	// isn't enabled in this environment.
	ErrUnsupportedProvider = errors.New("sign-in provider not supported")
	// ErrInvalidIDToken is returned for an ID token that fails verification:
	// a bad signature, the wrong issuer or audience, or an expired token.
	ErrInvalidIDToken = errors.New("invalid ID token")
	// ErrEmailNotVerified is returned when the provider doesn't report the
	// email address as verified. Such sign-ins are rejected, so every account
	// has a verified email to match on (BR-ACC-07).
	ErrEmailNotVerified = errors.New("email address not verified by the provider")
	// ErrUnauthenticated is returned for a request without a valid session.
	ErrUnauthenticated = errors.New("not signed in")
	// ErrNotFound is returned by repositories when no row matches.
	ErrNotFound = errors.New("not found")
	// ErrConflict is returned by repositories when a write breaks a unique
	// constraint, e.g. a concurrent sign-in created the same user first.
	ErrConflict = errors.New("conflicting write")
)

// User is a Lumei account.
type User struct {
	ID    uuid.UUID
	Email string
}

// Identity is a user's sign-in with one provider, as its ID token reports it.
type Identity struct {
	Provider Provider
	// Subject is the provider's stable ID for the user.
	Subject       string
	Email         string
	EmailVerified bool
}

// Session is a signed-in device. Only the hash of its refresh token is stored.
type Session struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	RefreshTokenHash []byte
	CreatedAt        time.Time
	ExpiresAt        time.Time
}

// StoredSession is a session found by one of its refresh tokens.
type StoredSession struct {
	ID        uuid.UUID
	User      User
	ExpiresAt time.Time
	// CurrentTokenHash is the hash of the session's current refresh token.
	CurrentTokenHash []byte
	// Current is false when the token that found the session is the one the
	// last refresh replaced.
	Current bool
	// RotatedAt is when the refresh token was last replaced; zero if never.
	RotatedAt time.Time
}

// Principal is the signed-in user a request acts for, as its access token
// says.
type Principal struct {
	User      User
	SessionID uuid.UUID
}

// AccessClaims is what an access token says about its bearer.
type AccessClaims struct {
	UserID    uuid.UUID
	Email     string
	SessionID uuid.UUID
	ExpiresAt time.Time
}

// AccessTokenIssuer signs and verifies access tokens.
type AccessTokenIssuer interface {
	// Issue returns a signed access token carrying claims.
	Issue(claims AccessClaims) (string, error)
	// Verify checks a token's signature and that it is valid at now, and
	// returns its claims.
	Verify(token string, now time.Time) (AccessClaims, error)
}

// IdentityVerifier verifies ID tokens from the sign-in providers.
type IdentityVerifier interface {
	// Verify checks idToken for provider and returns the identity it carries.
	// It returns ErrUnsupportedProvider or an error wrapping ErrInvalidIDToken.
	Verify(ctx context.Context, provider Provider, idToken string) (Identity, error)
}

// UserRepository stores users and their sign-in identities.
type UserRepository interface {
	// FindByIdentity returns the user an identity is linked to, or ErrNotFound.
	FindByIdentity(ctx context.Context, provider Provider, subject string) (User, error)
	// FindByEmail returns the user with the email address, or ErrNotFound.
	FindByEmail(ctx context.Context, email string) (User, error)
	// CreateWithIdentity creates a user and links the identity to it, both or
	// neither. It returns ErrConflict if the email or identity is taken.
	CreateWithIdentity(ctx context.Context, user User, identity Identity) error
	// AddIdentity links an identity to an existing user. It returns
	// ErrConflict if the identity is already linked.
	AddIdentity(ctx context.Context, userID uuid.UUID, identity Identity) error
}

// SessionRepository stores sessions.
type SessionRepository interface {
	// Create stores a new session.
	Create(ctx context.Context, session Session) error
	// FindByRefreshToken returns the session whose current or previous
	// refresh token has tokenHash, or ErrNotFound.
	FindByRefreshToken(ctx context.Context, tokenHash []byte) (StoredSession, error)
	// Rotate replaces the session's refresh token, keeping the current one as
	// the previous, and moves its expiry. It returns ErrConflict if the
	// current token is no longer currentHash: a concurrent refresh won.
	Rotate(ctx context.Context, id uuid.UUID, currentHash, newHash []byte, now, expiresAt time.Time) error
	// Delete removes the session. Deleting a missing session is not an error.
	Delete(ctx context.Context, id uuid.UUID) error
}

// AuthPolicy holds the lifetimes of sessions and their tokens.
type AuthPolicy struct {
	// SessionTTL is how long a session lasts after its last refresh
	// (BR-ACC-03).
	SessionTTL time.Duration
	// AccessTokenTTL is how long an access token is valid.
	AccessTokenTTL time.Duration
	// RefreshReuseGrace is how long a replaced refresh token still works.
	RefreshReuseGrace time.Duration
}

// SignInInput is a sign-in request.
type SignInInput struct {
	Provider Provider
	IDToken  string
}

// Tokens are what a sign-in or refresh hands the app.
type Tokens struct {
	// AccessToken authenticates requests until AccessTokenExpiresAt.
	AccessToken          string
	AccessTokenExpiresAt time.Time
	// RefreshToken gets new tokens. It is only ever returned here; the
	// server keeps just its hash.
	RefreshToken string
	User         User
}

// Authenticator signs users in and out, renews their tokens, and
// authenticates their requests.
type Authenticator interface {
	// SignIn verifies a provider's ID token, finds or creates the user, and
	// starts a session.
	SignIn(ctx context.Context, input SignInInput) (Tokens, error)
	// Refresh exchanges a refresh token for new tokens. It returns
	// ErrUnauthenticated for an unknown, expired, or reused token.
	Refresh(ctx context.Context, refreshToken string) (Tokens, error)
	// Authenticate returns the principal of an access token. It returns an
	// error wrapping ErrUnauthenticated for a missing, invalid, or expired
	// token.
	Authenticate(ctx context.Context, accessToken string) (Principal, error)
	// SignOut ends the session of the principal in ctx.
	SignOut(ctx context.Context) error
}

// AuthUsecase implements Authenticator.
type AuthUsecase struct {
	verifier IdentityVerifier
	users    UserRepository
	sessions SessionRepository
	issuer   AccessTokenIssuer
	policy   AuthPolicy
	now      func() time.Time
}

var _ Authenticator = (*AuthUsecase)(nil)

// NewAuthenticator creates an AuthUsecase. now is the clock; pass time.Now.
func NewAuthenticator(
	verifier IdentityVerifier,
	users UserRepository,
	sessions SessionRepository,
	issuer AccessTokenIssuer,
	policy AuthPolicy,
	now func() time.Time,
) *AuthUsecase {

	return &AuthUsecase{
		verifier: verifier,
		users:    users,
		sessions: sessions,
		issuer:   issuer,
		policy:   policy,
		now:      now,
	}
}

// SignIn verifies the ID token and starts a session for its user. The first
// sign-in creates the account (BR-ACC-01). A sign-in whose verified email
// matches an existing account opens that account and links the new sign-in
// to it (BR-ACC-07); any other email gets a separate account (BR-ACC-08).
func (a *AuthUsecase) SignIn(ctx context.Context, input SignInInput) (Tokens, error) {
	identity, err := a.verifier.Verify(ctx, input.Provider, input.IDToken)
	if err != nil {
		return Tokens{}, fmt.Errorf("failed to verify the ID token: %w", err)
	}
	if !identity.EmailVerified || identity.Email == "" {
		return Tokens{}, ErrEmailNotVerified
	}
	identity.Email = normalizeEmail(identity.Email)

	user, err := a.findOrCreateUser(ctx, identity)
	if errors.Is(err, ErrConflict) {
		// A concurrent sign-in with the same identity or email created its
		// rows first. They exist now, so a second pass finds them.
		user, err = a.findOrCreateUser(ctx, identity)
	}
	if err != nil {
		return Tokens{}, err
	}

	refreshToken, refreshHash := newRefreshToken()
	now := a.now()
	session := Session{
		ID:               uuid.Must(uuid.NewV7()),
		UserID:           user.ID,
		RefreshTokenHash: refreshHash,
		CreatedAt:        now,
		ExpiresAt:        now.Add(a.policy.SessionTTL),
	}
	if err := a.sessions.Create(ctx, session); err != nil {
		return Tokens{}, fmt.Errorf("failed to create the session: %w", err)
	}
	return a.tokens(session.ID, user, refreshToken, now)
}

// findOrCreateUser returns the user linked to identity, else links identity to
// the user with its email, else creates a user for it.
func (a *AuthUsecase) findOrCreateUser(ctx context.Context, identity Identity) (User, error) {
	user, err := a.users.FindByIdentity(ctx, identity.Provider, identity.Subject)
	if err == nil {
		return user, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return User{}, fmt.Errorf("failed to find the user by identity: %w", err)
	}

	user, err = a.users.FindByEmail(ctx, identity.Email)
	switch {
	case err == nil:
		if err := a.users.AddIdentity(ctx, user.ID, identity); err != nil {
			return User{}, fmt.Errorf("failed to link the identity to the user: %w", err)
		}
		return user, nil
	case errors.Is(err, ErrNotFound):
		user = User{ID: uuid.Must(uuid.NewV7()), Email: identity.Email}
		if err := a.users.CreateWithIdentity(ctx, user, identity); err != nil {
			return User{}, fmt.Errorf("failed to create the user: %w", err)
		}
		return user, nil
	default:
		return User{}, fmt.Errorf("failed to find the user by email: %w", err)
	}
}

// Refresh replaces the refresh token and issues a new access token, and
// extends the session to SessionTTL from now (BR-ACC-03).
func (a *AuthUsecase) Refresh(ctx context.Context, refreshToken string) (Tokens, error) {
	tokenHash := hashToken(refreshToken)

	tokens, err := a.refresh(ctx, tokenHash)
	if errors.Is(err, ErrConflict) {
		// A concurrent refresh with the same token replaced it first. The
		// token is now the previous one, which the second pass accepts
		// within the grace period.
		tokens, err = a.refresh(ctx, tokenHash)
	}
	return tokens, err
}

// refresh runs one attempt of Refresh.
func (a *AuthUsecase) refresh(ctx context.Context, tokenHash []byte) (Tokens, error) {
	session, err := a.sessions.FindByRefreshToken(ctx, tokenHash)
	if errors.Is(err, ErrNotFound) {
		return Tokens{}, ErrUnauthenticated
	}
	if err != nil {
		return Tokens{}, fmt.Errorf("failed to find the session: %w", err)
	}

	now := a.now()
	if !now.Before(session.ExpiresAt) {
		return Tokens{}, fmt.Errorf("%w: the session has expired", ErrUnauthenticated)
	}
	if !session.Current && now.Sub(session.RotatedAt) > a.policy.RefreshReuseGrace {
		// Only someone holding a copy reuses a replaced token this late, so
		// the session is ended for whoever holds it.
		if err := a.sessions.Delete(ctx, session.ID); err != nil {
			return Tokens{}, fmt.Errorf("failed to end the session of a reused refresh token: %w", err)
		}
		return Tokens{}, fmt.Errorf("%w: a replaced refresh token was reused", ErrUnauthenticated)
	}

	refreshToken, refreshHash := newRefreshToken()
	err = a.sessions.Rotate(ctx, session.ID, session.CurrentTokenHash, refreshHash,
		now, now.Add(a.policy.SessionTTL))
	if err != nil {
		return Tokens{}, fmt.Errorf("failed to replace the refresh token: %w", err)
	}
	return a.tokens(session.ID, session.User, refreshToken, now)
}

// tokens issues an access token for the session and bundles it with the
// refresh token.
func (a *AuthUsecase) tokens(
	sessionID uuid.UUID,
	user User,
	refreshToken string,
	now time.Time,
) (Tokens, error) {

	expiresAt := now.Add(a.policy.AccessTokenTTL)
	accessToken, err := a.issuer.Issue(AccessClaims{
		UserID:    user.ID,
		Email:     user.Email,
		SessionID: sessionID,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return Tokens{}, fmt.Errorf("failed to issue the access token: %w", err)
	}
	return Tokens{
		AccessToken:          accessToken,
		AccessTokenExpiresAt: expiresAt,
		RefreshToken:         refreshToken,
		User:                 user,
	}, nil
}

// Authenticate verifies the access token without the database: its
// signature and expiry are the proof.
func (a *AuthUsecase) Authenticate(_ context.Context, accessToken string) (Principal, error) {
	if accessToken == "" {
		return Principal{}, ErrUnauthenticated
	}
	claims, err := a.issuer.Verify(accessToken, a.now())
	if err != nil {
		return Principal{}, fmt.Errorf("%w: %w", ErrUnauthenticated, err)
	}
	return Principal{
		User:      User{ID: claims.UserID, Email: claims.Email},
		SessionID: claims.SessionID,
	}, nil
}

// SignOut deletes the session of the principal in ctx (BR-ACC-04), so its
// refresh token stops working. Its access token is checked without the
// database, so it keeps working until it expires, at most AccessTokenTTL.
// The user's sessions on other devices stay signed in.
func (a *AuthUsecase) SignOut(ctx context.Context) error {
	principal, ok := PrincipalFrom(ctx)
	if !ok {
		return ErrUnauthenticated
	}
	if err := a.sessions.Delete(ctx, principal.SessionID); err != nil {
		return fmt.Errorf("failed to delete the session: %w", err)
	}
	return nil
}

type principalKey struct{}

// WithPrincipal returns a copy of ctx carrying the request's principal.
func WithPrincipal(ctx context.Context, principal Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, principal)
}

// PrincipalFrom returns the principal of an authenticated request. Every
// use case acting on a user's data reads the user from here, never from the
// request, so a user can only reach their own data (BR-ACC-02).
func PrincipalFrom(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalKey{}).(Principal)
	return principal, ok
}

// normalizeEmail lower-cases an email address, so the same address in a
// different case matches the same account (BR-ACC-07).
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// newRefreshToken returns a random 256-bit refresh token and its hash.
func newRefreshToken() (token string, tokenHash []byte) {
	random := make([]byte, 32)
	_, _ = rand.Read(random) // crypto/rand.Read never returns an error.
	token = base64.RawURLEncoding.EncodeToString(random)
	return token, hashToken(token)
}

// hashToken returns the SHA-256 hash a refresh token is stored under.
func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
