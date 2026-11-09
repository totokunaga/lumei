package application

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
)

var (
	// ErrRevocationUnsupported is returned by a SignInRevoker for a provider
	// this server has no credentials to revoke for, e.g. before the Apple key
	// is set up.
	ErrRevocationUnsupported = errors.New("revoking this provider's sign-ins isn't set up")
	// ErrRevocationUnavailable is returned when a provider can't be reached,
	// or fails, while revoking a sign-in. Deleting the account can be tried
	// again later.
	ErrRevocationUnavailable = errors.New("the sign-in provider is unavailable")
)

// ProviderToken is an Apple or Google refresh token, which revokes the app's
// access to a sign-in (BR-ACC-05).
type ProviderToken struct {
	// ClientID is the app's client ID the token was issued to.
	ClientID string
	Token    string
}

// LinkedIdentity is one of a user's sign-ins, with the token that revokes it.
type LinkedIdentity struct {
	Provider Provider
	Subject  string
	// Token is nil when none is stored, e.g. for a sign-in made before tokens
	// were stored, or one whose provider isn't set up for revoking.
	Token *ProviderToken
}

// SignInRevoker trades the authorization codes of sign-ins for tokens, and
// revokes the app's access with them (BR-ACC-05).
type SignInRevoker interface {
	// Exchange trades code, from a sign-in issued to clientID, for a token
	// that can revoke it. It returns ErrRevocationUnsupported for a provider
	// that isn't set up.
	Exchange(ctx context.Context, provider Provider, clientID, code string) (ProviderToken, error)
	// Revoke ends the app's access to the sign-in. A token the provider no
	// longer knows, e.g. because the user removed the app's access, counts
	// as revoked. It returns ErrRevocationUnsupported for a provider that
	// isn't set up, and an error wrapping ErrRevocationUnavailable when the
	// provider can't be reached or fails.
	Revoke(ctx context.Context, provider Provider, token ProviderToken) error
}

// AccountDeleter deletes accounts (BR-ACC-05).
type AccountDeleter interface {
	// Delete revokes the app's access to every sign-in of the principal in
	// ctx, then deletes the account and all of its data. It returns an error
	// wrapping ErrRevocationUnavailable, and deletes nothing, when a provider
	// can't revoke right now.
	Delete(ctx context.Context) error
}

// AccountUsecase implements AccountDeleter.
type AccountUsecase struct {
	users   UserRepository
	revoker SignInRevoker
	logger  *slog.Logger
}

var _ AccountDeleter = (*AccountUsecase)(nil)

// NewAccountDeleter creates an AccountUsecase.
func NewAccountDeleter(users UserRepository, revoker SignInRevoker, logger *slog.Logger) *AccountUsecase {
	return &AccountUsecase{users: users, revoker: revoker, logger: logger}
}

// Delete revokes every sign-in linked to the account first, so a failure
// leaves the account whole to try again. Then it deletes the user, which
// removes all of their data: sessions, identities, and every synced record,
// locations included (BR-ACC-05). Other devices' sessions end with it; their
// access tokens are checked without the database, so they keep working until
// they expire, but every write with them fails with ErrAccountGone.
func (u *AccountUsecase) Delete(ctx context.Context) error {
	principal, ok := PrincipalFrom(ctx)
	if !ok {
		return ErrUnauthenticated
	}
	userID := principal.User.ID

	identities, err := u.users.LinkedIdentities(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to read the account's sign-ins: %w", err)
	}
	for _, identity := range identities {
		if err := u.revoke(ctx, identity); err != nil {
			return err
		}
	}

	if err := u.users.Delete(ctx, userID); err != nil {
		return fmt.Errorf("failed to delete the account: %w", err)
	}
	u.logger.InfoContext(ctx, "deleted an account", "user_id", userID)
	return nil
}

// revoke revokes one sign-in. One without a token, or whose provider isn't
// set up here, can't be revoked; that is logged, and the deletion goes on.
func (u *AccountUsecase) revoke(ctx context.Context, identity LinkedIdentity) error {
	if identity.Provider == ProviderDev {
		return nil
	}
	if identity.Token == nil {
		u.logger.WarnContext(ctx, "can't revoke a sign-in without a stored token",
			"provider", identity.Provider)
		return nil
	}
	err := u.revoker.Revoke(ctx, identity.Provider, *identity.Token)
	if errors.Is(err, ErrRevocationUnsupported) {
		u.logger.WarnContext(ctx, "can't revoke a sign-in: the provider isn't set up for it",
			"provider", identity.Provider)
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to revoke the %s sign-in: %w", identity.Provider, err)
	}
	return nil
}
