package repository

import (
	"context"
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
	return userRepoMocks{repo: NewUserRepository(db), db: dbMock}
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
