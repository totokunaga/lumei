package repository

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/uptrace/bun"

	"github.com/totokunaga/lumei/backend/internal/application"
)

// Lookups, inserts, and the not-found translation are covered by
// test/integration. These cases cover what it can't produce on demand: a
// unique violation from a concurrent sign-in, and a failure halfway through
// the user's transaction.

// pgError stands in for pgdriver.Error, which only the driver can build.
type pgError struct{ code string }

func (e pgError) Error() string { return "pg error " + e.code }

// Field returns the SQLSTATE for 'C', as pgdriver.Error does.
func (e pgError) Field(k byte) string {
	if k == 'C' {
		return e.code
	}
	return ""
}

// translatedSentinels are the errors translate turns driver errors into. A
// driver error that is neither must be wrapped without becoming one.
var translatedSentinels = []error{application.ErrConflict, application.ErrNotFound}

var (
	errUniqueViolation = pgError{code: uniqueViolation}
	repoUser           = application.User{
		ID:    uuid.MustParse("0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d10"),
		Email: "user@example.com",
	}
	repoIdentity = application.Identity{
		Provider:      application.ProviderGoogle,
		Subject:       "sub-1",
		Email:         "user@example.com",
		EmailVerified: true,
	}
)

type userRepoMocks struct {
	repo *UserRepository
	db   sqlmock.Sqlmock
}

func newUserRepoTestEnv(db *bun.DB, dbMock sqlmock.Sqlmock) userRepoMocks {
	return userRepoMocks{repo: NewUserRepository(db, prefixCipher{}), db: dbMock}
}

// prefixCipher stands in for the token cipher: it seals by prefixing
// "sealed:", and fails to open anything else.
type prefixCipher struct{}

func (prefixCipher) Seal(plaintext []byte) []byte {
	return append([]byte("sealed:"), plaintext...)
}

func (prefixCipher) Open(sealed []byte) ([]byte, error) {
	token, ok := bytes.CutPrefix(sealed, []byte("sealed:"))
	if !ok {
		return nil, errors.New("not sealed")
	}
	return token, nil
}

func TestUserRepository_CreateWithIdentity(t *testing.T) {
	t.Parallel()

	tests := []testRepositoryInput[struct{}, struct{}, userRepoMocks]{
		{
			name: "ErrConflict when a concurrent sign-in inserted the email first",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectBegin()
				m.db.ExpectQuery(`INSERT INTO "users"`).WillReturnError(errUniqueViolation)
				m.db.ExpectRollback()
			},
			assertFunc: assertSentinel[struct{}](application.ErrConflict),
		},
		{
			name: "rolls back the user when inserting the identity fails",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectBegin()
				m.db.ExpectQuery(`INSERT INTO "users"`).
					WillReturnRows(sqlmock.NewRows([]string{"created_at", "updated_at"}))
				m.db.ExpectQuery(`INSERT INTO "user_identities"`).WillReturnError(errConnReset)
				m.db.ExpectRollback()
			},
			expectedErrMsg: "failed to insert the identity",
			assertFunc:     assertWrappedNotSentinel[struct{}](translatedSentinels...),
		},
	}

	runRepositoryTestCases(t, tests, newUserRepoTestEnv,
		func(ctx context.Context, m userRepoMocks, _ struct{}) (struct{}, error) {
			return struct{}{}, m.repo.CreateWithIdentity(ctx, repoUser, repoIdentity)
		})
}

func TestUserRepository_AddIdentity(t *testing.T) {
	t.Parallel()

	tests := []testRepositoryInput[struct{}, struct{}, userRepoMocks]{
		{
			name: "ErrConflict when a concurrent sign-in linked the identity first",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectQuery(`INSERT INTO "user_identities"`).WillReturnError(errUniqueViolation)
			},
			assertFunc: assertSentinel[struct{}](application.ErrConflict),
		},
	}

	runRepositoryTestCases(t, tests, newUserRepoTestEnv,
		func(ctx context.Context, m userRepoMocks, _ struct{}) (struct{}, error) {
			return struct{}{}, m.repo.AddIdentity(ctx, repoUser.ID, repoIdentity)
		})
}

func TestUserRepository_SaveProviderToken(t *testing.T) {
	t.Parallel()

	tests := []testRepositoryInput[struct{}, struct{}, userRepoMocks]{
		{
			name: "seals the token before storing it (BR-ACC-05)",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectExec(`UPDATE "user_identities" .*'\\x7365616c65643a72742d31'.*'web-client'`).
					WillReturnResult(sqlmock.NewResult(0, 1))
			},
			assertFunc: assertOutput[struct{}],
		},
		{
			name: "wraps a failed update",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectExec(`UPDATE "user_identities"`).WillReturnError(errConnReset)
			},
			expectedErrMsg: "failed to store the revocation token",
			assertFunc:     assertWrappedNotSentinel[struct{}](translatedSentinels...),
		},
		{
			name: "wraps a failure to count the updated rows",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectExec(`UPDATE "user_identities"`).
					WillReturnResult(sqlmock.NewErrorResult(errConnReset))
			},
			expectedErrMsg: "failed to count the identities updated",
			assertFunc:     assertWrappedNotSentinel[struct{}](translatedSentinels...),
		},
		{
			name: "ErrNotFound when the identity was unlinked meanwhile",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectExec(`UPDATE "user_identities"`).WillReturnResult(sqlmock.NewResult(0, 0))
			},
			assertFunc: assertSentinel[struct{}](application.ErrNotFound),
		},
	}

	runRepositoryTestCases(t, tests, newUserRepoTestEnv,
		func(ctx context.Context, m userRepoMocks, _ struct{}) (struct{}, error) {
			token := application.ProviderToken{ClientID: "web-client", Token: "rt-1"}
			return struct{}{}, m.repo.SaveProviderToken(ctx, application.ProviderGoogle, "sub-1", token)
		})
}

func TestUserRepository_LinkedIdentities(t *testing.T) {
	t.Parallel()

	columns := []string{"provider", "subject", "revocation_token", "revocation_client_id"}
	tests := []testRepositoryInput[struct{}, []application.LinkedIdentity, userRepoMocks]{
		{
			name: "opens each stored token, and leaves the others without one (BR-ACC-05)",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectQuery(`SELECT .* FROM "user_identities"`).WillReturnRows(
					sqlmock.NewRows(columns).
						AddRow("google", "sub-1", []byte("sealed:rt-1"), "web-client").
						AddRow("apple", "sub-2", nil, nil))
			},
			expectedOutput: []application.LinkedIdentity{
				{
					Provider: application.ProviderGoogle, Subject: "sub-1",
					Token: &application.ProviderToken{ClientID: "web-client", Token: "rt-1"},
				},
				{Provider: application.ProviderApple, Subject: "sub-2"},
			},
			assertFunc: assertOutput[[]application.LinkedIdentity],
		},
		{
			name: "fails on a token that won't open, e.g. sealed under another key",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectQuery(`SELECT .* FROM "user_identities"`).WillReturnRows(
					sqlmock.NewRows(columns).AddRow("google", "sub-1", []byte("garbage"), "web-client"))
			},
			expectedErrMsg: "failed to open the google revocation token",
			assertFunc:     assertError[[]application.LinkedIdentity],
		},
		{
			name: "wraps a failed select",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectQuery(`SELECT .* FROM "user_identities"`).WillReturnError(errConnReset)
			},
			expectedErrMsg: "failed to select the identities",
			assertFunc:     assertWrappedNotSentinel[[]application.LinkedIdentity](translatedSentinels...),
		},
	}

	runRepositoryTestCases(t, tests, newUserRepoTestEnv,
		func(ctx context.Context, m userRepoMocks, _ struct{}) ([]application.LinkedIdentity, error) {
			return m.repo.LinkedIdentities(ctx, repoUser.ID)
		})
}

func TestUserRepository_Delete(t *testing.T) {
	t.Parallel()

	tests := []testRepositoryInput[struct{}, struct{}, userRepoMocks]{
		{
			name: "wraps a failed delete",
			setupMocks: func(m userRepoMocks) {
				m.db.ExpectExec(`DELETE FROM "users"`).WillReturnError(errConnReset)
			},
			expectedErrMsg: "failed to delete the user",
			assertFunc:     assertWrappedNotSentinel[struct{}](translatedSentinels...),
		},
	}

	runRepositoryTestCases(t, tests, newUserRepoTestEnv,
		func(ctx context.Context, m userRepoMocks, _ struct{}) (struct{}, error) {
			return struct{}{}, m.repo.Delete(ctx, repoUser.ID)
		})
}
