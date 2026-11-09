package application_test

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"testing"

	"go.uber.org/mock/gomock"

	"github.com/totokunaga/lumei/backend/internal/application"
	"github.com/totokunaga/lumei/backend/internal/mock"
)

type accountMocks struct {
	users   *mock.MockUserRepository
	revoker *mock.MockSignInRevoker
}

func newAccountTestEnv(ctrl *gomock.Controller) accountMocks {
	return accountMocks{
		users:   mock.NewMockUserRepository(ctrl),
		revoker: mock.NewMockSignInRevoker(ctrl),
	}
}

// accountToken is the stored token of the test's Google sign-in.
var accountToken = application.ProviderToken{ClientID: "web-client", Token: "refresh-token"}

// deleteInput is whether the request is signed in.
type deleteInput struct{ signedIn bool }

// The cases the integration tests can't reach: a missing principal, a
// database failure, a dev sign-in, and a revoker without credentials.
func TestAccountUsecase_Delete(t *testing.T) {
	t.Parallel()

	signedIn := deleteInput{signedIn: true}
	tests := []testUseCaseInput[deleteInput, struct{}, accountMocks]{
		{
			name:       "ErrUnauthenticated without a signed-in principal",
			assertFunc: assertSentinelError[struct{}](application.ErrUnauthenticated),
		},
		{
			name:  "fails, deleting nothing, when the sign-ins can't be read",
			input: signedIn,
			setupMocks: func(m accountMocks) {
				m.users.EXPECT().LinkedIdentities(gomock.Any(), authUser.ID).
					Return(nil, errors.New("db down"))
			},
			expectedErrMsg: "failed to read the account's sign-ins: db down",
			assertFunc:     assertNoResultError[struct{}],
		},
		{
			name:  "deletes a dev sign-in's account without revoking it",
			input: signedIn,
			setupMocks: func(m accountMocks) {
				m.users.EXPECT().LinkedIdentities(gomock.Any(), authUser.ID).
					Return([]application.LinkedIdentity{
						{Provider: application.ProviderDev, Subject: "dev@example.com"},
					}, nil)
				m.users.EXPECT().Delete(gomock.Any(), authUser.ID).Return(nil)
			},
			assertFunc: assertNoResultSuccess[struct{}],
		},
		{
			name:  "deletes without revoking a sign-in whose provider isn't set up",
			input: signedIn,
			setupMocks: func(m accountMocks) {
				m.users.EXPECT().LinkedIdentities(gomock.Any(), authUser.ID).
					Return([]application.LinkedIdentity{
						{Provider: application.ProviderGoogle, Subject: "sub-1", Token: &accountToken},
					}, nil)
				m.revoker.EXPECT().Revoke(gomock.Any(), application.ProviderGoogle, accountToken).
					Return(fmt.Errorf("%w: google", application.ErrRevocationUnsupported))
				m.users.EXPECT().Delete(gomock.Any(), authUser.ID).Return(nil)
			},
			assertFunc: assertNoResultSuccess[struct{}],
		},
		{
			name:  "fails when the account can't be deleted after revoking",
			input: signedIn,
			setupMocks: func(m accountMocks) {
				m.users.EXPECT().LinkedIdentities(gomock.Any(), authUser.ID).Return(nil, nil)
				m.users.EXPECT().Delete(gomock.Any(), authUser.ID).Return(errors.New("db down"))
			},
			expectedErrMsg: "failed to delete the account: db down",
			assertFunc:     assertNoResultError[struct{}],
		},
	}

	runUseCaseTestCases(t, tests, newAccountTestEnv,
		func(ctx context.Context, m accountMocks, in deleteInput) (struct{}, error) {
			if in.signedIn {
				ctx = application.WithPrincipal(ctx, application.Principal{User: authUser})
			}
			deleter := application.NewAccountDeleter(m.users, m.revoker, slog.New(slog.DiscardHandler))
			return struct{}{}, deleter.Delete(ctx)
		})
}
