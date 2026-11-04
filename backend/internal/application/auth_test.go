package application_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/mock"
)

// Sign-in, refresh, authentication, and sign-out through HTTP are covered by
// test/integration. These cases cover what it can't produce: a concurrent
// sign-in or refresh racing this one, and failures after the first query.

var (
	authNow    = time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	authPolicy = application.AuthPolicy{
		SessionTTL:        90 * 24 * time.Hour,
		AccessTokenTTL:    15 * time.Minute,
		RefreshReuseGrace: time.Minute,
	}
	errDBDown = errors.New("connection reset")
	authUser  = application.User{
		ID:    uuid.MustParse("0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d10"),
		Email: "user@example.com",
	}
	authIdentity = application.Identity{
		Provider:      application.ProviderGoogle,
		Subject:       "sub-1",
		Email:         "User@Example.com",
		EmailVerified: true,
	}
	googleSignIn  = application.SignInInput{Provider: application.ProviderGoogle, IDToken: "id-token"}
	storedSession = application.StoredSession{
		ID:               uuid.MustParse("0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d11"),
		User:             authUser,
		ExpiresAt:        authNow.Add(time.Hour),
		CurrentTokenHash: []byte("current-hash"),
		Current:          true,
	}
)

type authMocks struct {
	verifier *mock.MockIdentityVerifier
	users    *mock.MockUserRepository
	sessions *mock.MockSessionRepository
	issuer   *mock.MockAccessTokenIssuer
}

func newAuthTestEnv(ctrl *gomock.Controller) authMocks {
	return authMocks{
		verifier: mock.NewMockIdentityVerifier(ctrl),
		users:    mock.NewMockUserRepository(ctrl),
		sessions: mock.NewMockSessionRepository(ctrl),
		issuer:   mock.NewMockAccessTokenIssuer(ctrl),
	}
}

// newAuthUsecase builds the use case under test from the mocks, with a fixed clock.
func newAuthUsecase(m authMocks) *application.AuthUsecase {
	return application.NewAuthenticator(m.verifier, m.users, m.sessions, m.issuer, authPolicy,
		func() time.Time { return authNow })
}

// expectVerified makes the verifier accept the test's ID token.
func expectVerified(m authMocks) {
	m.verifier.EXPECT().Verify(gomock.Any(), application.ProviderGoogle, "id-token").Return(authIdentity, nil)
}

// expectNewUser sets up a verified identity whose user doesn't exist yet,
// whose creation then returns createErr.
func expectNewUser(m authMocks, createErr error) {
	expectVerified(m)
	m.users.EXPECT().FindByIdentity(gomock.Any(), application.ProviderGoogle, "sub-1").
		Return(application.User{}, application.ErrNotFound)
	m.users.EXPECT().FindByEmail(gomock.Any(), "user@example.com").
		Return(application.User{}, application.ErrNotFound)
	m.users.EXPECT().CreateWithIdentity(gomock.Any(), gomock.Any(), gomock.Any()).Return(createErr)
}

// expectIssued makes the issuer sign an access token for user that expires
// AccessTokenTTL after the fixed clock.
func expectIssued(m authMocks, user application.User) {
	m.issuer.EXPECT().Issue(gomock.Any()).DoAndReturn(func(c application.AccessClaims) (string, error) {
		if c.UserID != user.ID || !c.ExpiresAt.Equal(authNow.Add(authPolicy.AccessTokenTTL)) {
			return "", fmt.Errorf("unexpected claims %+v", c)
		}
		return "access-token", nil
	})
}

// assertTokensFor builds an assertFunc requiring tokens for user. The
// refresh token is random, so it is only checked to be set.
func assertTokensFor(user application.User) func(
	*testing.T, *application.Tokens, *application.Tokens, error, string,
) {

	return func(t *testing.T, output, _ *application.Tokens, err error, _ string) {
		t.Helper()

		require.NoError(t, err)
		assert.Equal(t, "access-token", output.AccessToken)
		assert.Equal(t, authNow.Add(authPolicy.AccessTokenTTL), output.AccessTokenExpiresAt)
		assert.NotEmpty(t, output.RefreshToken)
		assert.Equal(t, user, output.User)
	}
}

func TestAuthUsecase_SignIn(t *testing.T) {
	t.Parallel()

	tests := []testUseCaseInput[application.SignInInput, *application.Tokens, authMocks]{
		{
			name:  "signs in to the user a concurrent sign-in created first",
			input: googleSignIn,
			setupMocks: func(m authMocks) {
				expectNewUser(m, fmt.Errorf("failed to insert the user: %w", application.ErrConflict))
				m.users.EXPECT().FindByIdentity(gomock.Any(), application.ProviderGoogle, "sub-1").
					Return(authUser, nil)
				m.sessions.EXPECT().Create(gomock.Any(), gomock.Any()).Return(nil)
				expectIssued(m, authUser)
			},
			assertFunc: assertTokensFor(authUser),
		},
		{
			name:  "fails when finding the user by email fails",
			input: googleSignIn,
			setupMocks: func(m authMocks) {
				expectVerified(m)
				m.users.EXPECT().FindByIdentity(gomock.Any(), gomock.Any(), gomock.Any()).
					Return(application.User{}, application.ErrNotFound)
				m.users.EXPECT().FindByEmail(gomock.Any(), gomock.Any()).Return(application.User{}, errDBDown)
			},
			expectedErrMsg: "failed to find the user by email",
			assertFunc:     assertError[*application.Tokens],
		},
		{
			name:  "fails when linking the identity to the user with its email fails",
			input: googleSignIn,
			setupMocks: func(m authMocks) {
				expectVerified(m)
				m.users.EXPECT().FindByIdentity(gomock.Any(), gomock.Any(), gomock.Any()).
					Return(application.User{}, application.ErrNotFound)
				m.users.EXPECT().FindByEmail(gomock.Any(), gomock.Any()).Return(authUser, nil)
				m.users.EXPECT().AddIdentity(gomock.Any(), authUser.ID, gomock.Any()).Return(errDBDown)
			},
			expectedErrMsg: "failed to link the identity to the user",
			assertFunc:     assertError[*application.Tokens],
		},
		{
			name:           "fails when creating the user fails",
			input:          googleSignIn,
			setupMocks:     func(m authMocks) { expectNewUser(m, errDBDown) },
			expectedErrMsg: "failed to create the user",
			assertFunc:     assertError[*application.Tokens],
		},
		{
			name:  "fails when creating the session fails",
			input: googleSignIn,
			setupMocks: func(m authMocks) {
				expectNewUser(m, nil)
				m.sessions.EXPECT().Create(gomock.Any(), gomock.Any()).Return(errDBDown)
			},
			expectedErrMsg: "failed to create the session",
			assertFunc:     assertError[*application.Tokens],
		},
		{
			name:  "fails when signing the access token fails",
			input: googleSignIn,
			setupMocks: func(m authMocks) {
				expectNewUser(m, nil)
				m.sessions.EXPECT().Create(gomock.Any(), gomock.Any()).Return(nil)
				m.issuer.EXPECT().Issue(gomock.Any()).Return("", errors.New("signer broke"))
			},
			expectedErrMsg: "failed to issue the access token",
			assertFunc:     assertError[*application.Tokens],
		},
	}

	runUseCaseTestCases(t, tests, newAuthTestEnv,
		func(ctx context.Context, m authMocks, input application.SignInInput) (*application.Tokens, error) {
			return outputPtr(newAuthUsecase(m).SignIn(ctx, input))
		})
}

func TestAuthUsecase_Refresh(t *testing.T) {
	t.Parallel()

	tests := []testUseCaseInput[string, *application.Tokens, authMocks]{
		{
			name:  "refreshes after a concurrent refresh replaced the token first",
			input: "refresh-token",
			setupMocks: func(m authMocks) {
				replaced := storedSession
				replaced.Current = false
				replaced.RotatedAt = authNow.Add(-time.Second)
				find := m.sessions.EXPECT().FindByRefreshToken(gomock.Any(), gomock.Any())
				gomock.InOrder(
					find.Return(storedSession, nil),
					m.sessions.EXPECT().Rotate(gomock.Any(), storedSession.ID, storedSession.CurrentTokenHash,
						gomock.Any(), authNow, authNow.Add(authPolicy.SessionTTL)).
						Return(fmt.Errorf("rotated concurrently: %w", application.ErrConflict)),
					m.sessions.EXPECT().FindByRefreshToken(gomock.Any(), gomock.Any()).
						Return(replaced, nil),
					m.sessions.EXPECT().Rotate(gomock.Any(), storedSession.ID, gomock.Any(),
						gomock.Any(), authNow, authNow.Add(authPolicy.SessionTTL)).Return(nil),
				)
				expectIssued(m, authUser)
			},
			assertFunc: assertTokensFor(authUser),
		},
		{
			name:  "fails when finding the session fails",
			input: "refresh-token",
			setupMocks: func(m authMocks) {
				m.sessions.EXPECT().FindByRefreshToken(gomock.Any(), gomock.Any()).
					Return(application.StoredSession{}, errDBDown)
			},
			expectedErrMsg: "failed to find the session",
			assertFunc:     assertError[*application.Tokens],
		},
		{
			name:  "fails when ending the session of a reused token fails",
			input: "refresh-token",
			setupMocks: func(m authMocks) {
				reused := storedSession
				reused.Current = false
				reused.RotatedAt = authNow.Add(-time.Hour)
				m.sessions.EXPECT().FindByRefreshToken(gomock.Any(), gomock.Any()).Return(reused, nil)
				m.sessions.EXPECT().Delete(gomock.Any(), storedSession.ID).Return(errDBDown)
			},
			expectedErrMsg: "failed to end the session of a reused refresh token",
			assertFunc:     assertError[*application.Tokens],
		},
		{
			name:  "fails when replacing the token fails",
			input: "refresh-token",
			setupMocks: func(m authMocks) {
				m.sessions.EXPECT().FindByRefreshToken(gomock.Any(), gomock.Any()).Return(storedSession, nil)
				m.sessions.EXPECT().Rotate(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(),
					gomock.Any(), gomock.Any()).Return(errDBDown)
			},
			expectedErrMsg: "failed to replace the refresh token",
			assertFunc:     assertError[*application.Tokens],
		},
	}

	runUseCaseTestCases(t, tests, newAuthTestEnv,
		func(ctx context.Context, m authMocks, refreshToken string) (*application.Tokens, error) {
			return outputPtr(newAuthUsecase(m).Refresh(ctx, refreshToken))
		})
}

func TestAuthUsecase_SignOut(t *testing.T) {
	t.Parallel()

	tests := []testUseCaseInput[struct{}, struct{}, authMocks]{
		{
			name:       "ErrUnauthenticated without a signed-in principal",
			assertFunc: assertSentinelError[struct{}](application.ErrUnauthenticated),
		},
	}

	runUseCaseTestCases(t, tests, newAuthTestEnv,
		func(ctx context.Context, m authMocks, _ struct{}) (struct{}, error) {
			return struct{}{}, newAuthUsecase(m).SignOut(ctx)
		})
}
